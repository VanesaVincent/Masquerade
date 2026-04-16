import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'missing', {
  auth: {
    persistSession: true,
    storage: AsyncStorage,
    autoRefreshToken: true,
  },
});

let cachedUid = null;

export function getUid() {
  return cachedUid;
}

export async function signInAnon() {
  try {
    const { data: existing, error: userError } = await supabase.auth.getUser();
    if (existing?.user?.id) {
      cachedUid = existing.user.id;
      return existing.user;
    }
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    cachedUid = data?.user?.id || null;
    return data.user;
  } catch (err) {
    console.error("Auth helper error:", err);
    throw err;
  }
}

async function requireUid() {
  if (cachedUid) return cachedUid;
  const { data: existing, error } = await supabase.auth.getUser();
  if (error || !existing?.user?.id) {
    throw new Error('Not signed in');
  }
  cachedUid = existing.user.id;
  return cachedUid;
}

// ---------- Query helpers ----------
export async function getRoom(roomCode) {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('room_code', roomCode)
    .single();
  if (error) throw error;
  return data;
}

export async function getPlayers(roomCode) {
  const { data, error } = await supabase
    .from('room_players')
    .select('user_id,name,is_imposter,has_seen_role')
    .eq('room_code', roomCode)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getVotes(roomCode) {
  const { data, error } = await supabase
    .from('room_votes')
    .select('voter_id,target_id,created_at')
    .eq('room_code', roomCode);
  if (error) throw error;
  return data || [];
}

// ---------- Writes ----------
export async function createRoom({ roomCode, hostId, hostName }) {
  const { error: roomError } = await supabase.from('rooms').insert({
    room_code: roomCode,
    host_id: hostId,
    phase: 'lobby',
  });
  if (roomError) throw roomError;

  const { error: playerError } = await supabase.from('room_players').insert({
    room_code: roomCode,
    user_id: hostId,
    name: hostName,
  });
  if (playerError) throw playerError;
}

export async function joinRoom({ roomCode, userId, name }) {
  const { error } = await supabase.from('room_players').insert({
    room_code: roomCode,
    user_id: userId,
    name,
  });
  if (error) throw error;
}

export async function leaveRoom(roomCode) {
  const uid = await requireUid();
  const { error } = await supabase
    .from('room_players')
    .delete()
    .eq('room_code', roomCode)
    .eq('user_id', uid);
  if (error) throw error;
}

export async function setTheme(roomCode, themeName) {
  const { error } = await supabase.from('rooms').update({ theme: themeName }).eq('room_code', roomCode);
  if (error) throw error;
}

export async function setHasSeenRole(roomCode) {
  const uid = await requireUid();
  const { error } = await supabase
    .from('room_players')
    .update({ has_seen_role: true })
    .eq('room_code', roomCode)
    .eq('user_id', uid);
  if (error) throw error;
}

export async function castVote({ roomCode, targetId }) {
  const uid = await requireUid();
  const { error } = await supabase
    .from('room_votes')
    .upsert(
      { room_code: roomCode, voter_id: uid, target_id: targetId },
      { onConflict: 'room_code,voter_id' }
    );
  if (error) throw error;
}

// ---------- RPC wrappers ----------
export async function rpcHostAssignRoles(roomCode) {
  const { error } = await supabase.rpc('host_assign_roles', { p_room_code: roomCode });
  if (error) throw error;
}

export async function rpcHostStartGame(roomCode) {
  const { error } = await supabase.rpc('host_start_game', { p_room_code: roomCode });
  if (error) throw error;
}

export async function rpcHostStartVoting(roomCode) {
  const { error } = await supabase.rpc('host_start_voting', { p_room_code: roomCode });
  if (error) throw error;
}

export async function rpcHostNextRound(roomCode) {
  const { error } = await supabase.rpc('host_next_round', { p_room_code: roomCode });
  if (error) throw error;
}

export async function rpcHostTallyVotes(roomCode) {
  const { error } = await supabase.rpc('host_tally_votes', { p_room_code: roomCode });
  if (error) throw error;
}

export async function rpcImposterSubmitGuess(roomCode, guess) {
  const { error } = await supabase.rpc('imposter_submit_guess', { p_room_code: roomCode, p_guess: guess });
  if (error) throw error;
}

export async function rpcHostPlayAgain(roomCode) {
  const { error } = await supabase.rpc('host_play_again', { p_room_code: roomCode });
  if (error) throw error;
}
