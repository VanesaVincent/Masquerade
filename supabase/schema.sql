-- Masquerade Supabase schema (rooms/room_players/room_votes + RLS + RPC)
-- Apply this in your Supabase project's SQL editor.

-- 0) Optional: ensure we can generate UUIDs if needed elsewhere
-- (Not required for auth.users UUIDs; Supabase auth provides them.)
-- create extension if not exists pgcrypto;

-- 1) Core tables
create table if not exists public.rooms (
  room_code text primary key,
  host_id uuid not null,
  phase text not null,
  round integer not null default 0,
  theme text null,
  word text null,
  timer_started_at timestamptz null,
  first_speaker_id uuid null,
  caught_id uuid null,
  result_winner text null,            -- 'town' | 'imposter'
  imposter_guess text null,
  result_word text null,
  caught_player_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_players (
  room_code text not null references public.rooms(room_code) on delete cascade,
  user_id uuid not null,
  name text not null,
  is_imposter boolean not null default false,
  has_seen_role boolean not null default false,
  primary key (room_code, user_id)
);

create table if not exists public.room_votes (
  room_code text not null references public.rooms(room_code) on delete cascade,
  voter_id uuid not null,
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (room_code, voter_id)
);

-- 2) Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rooms_updated_at on public.rooms;
create trigger trg_rooms_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

-- 3) RLS
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_votes enable row level security;

-- 3a) rooms policies
-- Read: any player in the room can read the room state (including `word`).
drop policy if exists "rooms_select_players" on public.rooms;
create policy "rooms_select_players"
on public.rooms
for select
using (
  exists (
    select 1
    from public.room_players rp
    where rp.room_code = rooms.room_code
      and rp.user_id = auth.uid()
  )
  or phase = 'lobby'
);

-- Insert: host can create a lobby room where host_id = auth.uid()
drop policy if exists "rooms_insert_host" on public.rooms;
create policy "rooms_insert_host"
on public.rooms
for insert
with check (
  host_id = auth.uid()
  and phase = 'lobby'
);

-- Update: only host can update the room directly (theme picker, etc.)
drop policy if exists "rooms_update_host" on public.rooms;
create policy "rooms_update_host"
on public.rooms
for update
using (host_id = auth.uid())
with check (host_id = auth.uid());

-- 3b) room_players policies
-- Read: any player can see everyone in the room (for lobby roster and voting list).
drop policy if exists "room_players_select_room_members" on public.room_players;
create policy "room_players_select_room_members"
on public.room_players
for select
using (
  exists (
    select 1
    from public.room_players rp2
    where rp2.room_code = room_players.room_code
      and rp2.user_id = auth.uid()
  )
);

-- Insert: joining is allowed only when the room is in 'lobby'.
-- Also enforce self-join: user_id must match auth.uid().
drop policy if exists "room_players_insert_join_lobby" on public.room_players;
create policy "room_players_insert_join_lobby"
on public.room_players
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.rooms r
    where r.room_code = room_players.room_code
      and r.phase = 'lobby'
  )
);

-- Update: allow users to update only their own row (Role reveal sets has_seen_role).
-- Additional restriction is enforced via a trigger (prevents changing is_imposter/name).
drop policy if exists "room_players_update_self" on public.room_players;
create policy "room_players_update_self"
on public.room_players
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 3c) room_votes policies
-- Read: any player in the room can see votes (used for vote counts during voting).
drop policy if exists "room_votes_select_room_members" on public.room_votes;
create policy "room_votes_select_room_members"
on public.room_votes
for select
using (
  exists (
    select 1
    from public.room_players rp
    where rp.room_code = room_votes.room_code
      and rp.user_id = auth.uid()
  )
);

-- Insert/upsert: only the voter can set their own vote.
drop policy if exists "room_votes_upsert_self" on public.room_votes;
create policy "room_votes_upsert_self"
on public.room_votes
for insert
with check (voter_id = auth.uid());

drop policy if exists "room_votes_update_self" on public.room_votes;
create policy "room_votes_update_self"
on public.room_votes
for update
using (voter_id = auth.uid())
with check (voter_id = auth.uid());

-- 4) Trigger to prevent non-host changing role-related fields
create or replace function public.restrict_room_player_mutations()
returns trigger
language plpgsql
as $$
declare
  host uuid;
begin
  select r.host_id into host
  from public.rooms r
  where r.room_code = new.room_code;

  -- If we can't find the room, deny update (defensive).
  if host is null then
    raise exception 'Room not found';
  end if;

  -- Non-host users may update only has_seen_role (and nothing else important).
  if auth.uid() is distinct from host then
    if new.is_imposter is distinct from old.is_imposter then
      raise exception 'Only host can change is_imposter';
    end if;
    if new.name is distinct from old.name then
      raise exception 'Only host can change player name';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_room_players_restrict on public.room_players;
create trigger trg_room_players_restrict
before update on public.room_players
for each row execute function public.restrict_room_player_mutations();

-- 5) Host-only RPC functions (atomic phase + role + timer transitions)
-- These functions are SECURITY DEFINER so the host logic is enforced centrally.

-- 5a) Assign roles and move to phase 'roles'
create or replace function public.host_assign_roles(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_theme text;
  v_word text;
  v_first_speaker uuid;
  v_imposter uuid;
  v_player_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Host check + fetch theme
  select r.theme, (select count(*) from public.room_players rp where rp.room_code = p_room_code) into v_theme, v_player_count
  from public.rooms r
  where r.room_code = p_room_code
    and r.host_id = auth.uid();

  if not found then
    raise exception 'Not host or room not found';
  end if;

  if v_theme is null then
    raise exception 'Theme not selected';
  end if;

  if v_player_count < 3 then
    raise exception 'Minimum 3 players required';
  end if;

  -- Pick random word based on theme (duplicated from gameData.js word lists).
  select words.word
  into v_word
  from (
    select unnest(case
      when v_theme = 'Movies' then array['Inception','Titanic','Avatar','The Matrix','Parasite','Interstellar','Joker','Frozen','Gladiator','Clueless']
      when v_theme = 'Animals' then array['Elephant','Dolphin','Penguin','Cheetah','Kangaroo','Flamingo','Octopus','Gorilla','Chameleon','Narwhal']
      when v_theme = 'Food' then array['Sushi','Biryani','Tacos','Croissant','Dumplings','Cheesecake','Ramen','Falafel','Paella','Tiramisu']
      when v_theme = 'Sports' then array['Cricket','Basketball','Badminton','Surfing','Fencing','Polo','Curling','Archery','Snooker','Bobsled']
      when v_theme = 'Places' then array['Machu Picchu','Santorini','Kyoto','Marrakech','Patagonia','Iceland','Maldives','Prague','New Orleans','Bali']
      when v_theme = 'Professions' then array['Astronaut','Locksmith','Sommelier','Taxidermist','Glassblower','Cartographer','Falconer','Puppeteer','Cryptographer','Gondolier']
      else array[]::text[]
    end) as word
  ) as words
  order by random()
  limit 1;

  if v_word is null then
    raise exception 'No words available for theme %', v_theme;
  end if;

  -- Pick random players
  select rp.user_id into v_first_speaker
  from public.room_players rp
  where rp.room_code = p_room_code
  order by random()
  limit 1;

  select rp.user_id into v_imposter
  from public.room_players rp
  where rp.room_code = p_room_code
  order by random()
  limit 1;

  -- Clear any old votes
  delete from public.room_votes where room_code = p_room_code;

  -- Update players roles
  update public.room_players
  set is_imposter = (user_id = v_imposter),
      has_seen_role = false
  where room_code = p_room_code;

  -- Update room to roles phase
  update public.rooms
  set phase = 'roles',
      round = 0,
      word = v_word,
      first_speaker_id = v_first_speaker,
      timer_started_at = null,
      caught_id = null,
      result_winner = null,
      imposter_guess = null,
      result_word = null,
      caught_player_name = null,
      updated_at = now()
  where room_code = p_room_code;
end;
$$;

-- 5b) Host starts the game (roles -> game)
create or replace function public.host_start_game(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_total int;
  v_ready int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select host_id into v_host
  from public.rooms
  where room_code = p_room_code;

  if v_host is null or v_host is distinct from auth.uid() then
    raise exception 'Not host';
  end if;

  if (select phase from public.rooms where room_code = p_room_code) is distinct from 'roles' then
    raise exception 'Room is not in roles phase';
  end if;

  select count(*) into v_total from public.room_players where room_code = p_room_code;
  select count(*) into v_ready from public.room_players where room_code = p_room_code and has_seen_role = true;

  if v_total < 3 then
    raise exception 'Minimum 3 players required';
  end if;

  if v_ready <> v_total then
    raise exception 'Not all players revealed yet';
  end if;

  delete from public.room_votes where room_code = p_room_code;

  update public.rooms
  set phase = 'game',
      round = 1,
      timer_started_at = now(),
      updated_at = now()
  where room_code = p_room_code;
end;
$$;

-- 5c) Host starts voting (game -> voting)
create or replace function public.host_start_voting(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update public.rooms r
  set phase = 'voting',
      updated_at = now()
  where r.room_code = p_room_code
    and r.host_id = auth.uid()
    and r.phase = 'game';

  if not found then
    raise exception 'Not host or invalid phase';
  end if;

  delete from public.room_votes where room_code = p_room_code;
end;
$$;

-- 5d) Host next round (game->game with round+1 + new timer)
create or replace function public.host_next_round(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update public.rooms r
  set phase = 'game',
      round = r.round + 1,
      timer_started_at = now(),
      updated_at = now()
  where r.room_code = p_room_code
    and r.host_id = auth.uid()
    and r.phase in ('game');

  if not found then
    raise exception 'Not host or invalid phase';
  end if;

  delete from public.room_votes where room_code = p_room_code;
end;
$$;

-- 5e) Host tally votes (voting -> game [tie] or guessing [winner])
create or replace function public.host_tally_votes(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_max int;
  v_top record;
  v_winner uuid;
  v_is_tie boolean := false;
  v_round int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select host_id, round into v_host, v_round
  from public.rooms
  where room_code = p_room_code;

  if v_host is null or v_host is distinct from auth.uid() then
    raise exception 'Not host';
  end if;

  if (select phase from public.rooms where room_code = p_room_code) is distinct from 'voting' then
    raise exception 'Room is not in voting phase';
  end if;

  -- Compute vote counts by target
  with counts as (
    select rv.target_id, count(*)::int as c
    from public.room_votes rv
    where rv.room_code = p_room_code
    group by rv.target_id
  ),
  ranked as (
    select target_id, c, dense_rank() over (order by c desc) as dr
    from counts
  )
  select
    max(c) as max_votes,
    (select target_id from ranked where dr = 1 order by target_id limit 1) as winner_id,
    (select count(*) from ranked where dr = 1) > 1 as is_tie
  into v_max, v_winner, v_is_tie;

  -- If there were no votes, treat as tie/advance.
  if v_winner is null then
    v_is_tie := true;
  end if;

  if v_is_tie then
    delete from public.room_votes where room_code = p_room_code;
    update public.rooms
    set phase = 'game',
        round = round + 1,
        timer_started_at = now(),
        caught_id = null,
        result_winner = null,
        imposter_guess = null,
        result_word = null,
        caught_player_name = null,
        updated_at = now()
    where room_code = p_room_code;
    return;
  end if;

  -- winner exists and is unique
  update public.rooms
  set phase = 'guessing',
      caught_id = v_winner,
      caught_player_name = (select name from public.room_players rp where rp.room_code = p_room_code and rp.user_id = v_winner),
      updated_at = now()
  where room_code = p_room_code;
end;
$$;

-- 5f) Imposter submits guess (guessing -> result)
create or replace function public.imposter_submit_guess(p_room_code text, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_word text;
  v_caught uuid;
  v_guess_ok boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_guess is null or length(trim(p_guess)) = 0 then
    raise exception 'Guess is required';
  end if;

  select word, caught_id
  into v_word, v_caught
  from public.rooms
  where room_code = p_room_code;

  if v_caught is null then
    raise exception 'No caught player';
  end if;

  if auth.uid() is distinct from v_caught then
    raise exception 'Only caught player can submit';
  end if;

  if (select phase from public.rooms where room_code = p_room_code) is distinct from 'guessing' then
    raise exception 'Room is not in guessing phase';
  end if;

  v_guess_ok := lower(trim(p_guess)) = lower(trim(v_word));

  update public.rooms
  set phase = 'result',
      result_winner = (case when v_guess_ok then 'imposter' else 'town' end),
      imposter_guess = trim(p_guess),
      result_word = v_word,
      updated_at = now()
  where room_code = p_room_code;
end;
$$;

-- 5g) Host resets back to lobby (result -> lobby)
create or replace function public.host_play_again(p_room_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update public.rooms r
  set phase = 'lobby',
      round = 0,
      theme = null,
      word = null,
      timer_started_at = null,
      first_speaker_id = null,
      caught_id = null,
      result_winner = null,
      imposter_guess = null,
      result_word = null,
      caught_player_name = null,
      updated_at = now()
  where r.room_code = p_room_code
    and r.host_id = auth.uid();

  if not found then
    raise exception 'Not host or room not found';
  end if;

  -- Reset role state for everyone but keep roster.
  update public.room_players
  set is_imposter = false,
      has_seen_role = false;

  -- Clear votes
  delete from public.room_votes where room_code = p_room_code;
end;
$$;

-- End of schema.sql

