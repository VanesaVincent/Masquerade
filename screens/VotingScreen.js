import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform } from 'react-native';

import {
  castVote as castVoteToServer,
  getPlayers,
  getRoom,
  getUid,
  getVotes,
  rpcHostPlayAgain,
  rpcHostTallyVotes,
  rpcImposterSubmitGuess,
} from '../supabase';

const COLORS = {
  bg: '#0F0F1A',
  surface: '#1C1C2E',
  primary: '#7C3AED',
  primaryLight: '#A78BFA',
  accent: '#F59E0B',
  danger: '#EF4444',
  success: '#10B981',
  text: '#F0F0FF',
  muted: '#8888AA',
  border: '#2E2E44',
};

function PrimaryButton({ title, onPress, disabled, variant }) {
  const filled = variant !== 'outlined';
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btnBase,
        filled ? styles.btnFilled : styles.btnOutlined,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={[styles.btnText, filled ? styles.btnTextFilled : styles.btnTextOutlined]}>{title}</Text>
    </TouchableOpacity>
  );
}

function Avatar({ name }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

export default function VotingScreen({ navigation, route }) {
  const roomCode = route?.params?.roomCode;
  const uid = getUid();

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [votes, setVotes] = useState([]);

  const [guess, setGuess] = useState('');
  const [myVote, setMyVote] = useState(null);

  const hasNavigatedAwayRef = useRef(false);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const r = await getRoom(roomCode);
        const ps = await getPlayers(roomCode);
        const vs = await getVotes(roomCode);
        if (!alive) return;

        setRoom(r);
        setPlayers(ps);
        setVotes(vs);

        if (hasNavigatedAwayRef.current) return;

        if (r.phase === 'lobby') {
          hasNavigatedAwayRef.current = true;
          navigation.replace('Lobby', { roomCode });
        } else if (r.phase === 'game') {
          hasNavigatedAwayRef.current = true;
          navigation.replace('Game', { roomCode });
        }
      } catch (e) {
        // Polling error skip
      }
    }

    refresh();
    const id = setInterval(refresh, 1000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [roomCode, navigation]);

  useEffect(() => {
    if (!uid) {
      setMyVote(null);
      return;
    }
    const voteRow = votes?.find((v) => v.voter_id === uid);
    setMyVote(voteRow?.target_id || null);
  }, [votes, uid]);

  const isHost = room && uid && room.host_id === uid;
  const phase = room?.phase;

  const voteCounts = useMemo(() => {
    const counts = {};
    for (const v of votes || []) {
      if (!v?.target_id) continue;
      const targetId = v.target_id;
      counts[targetId] = (counts[targetId] || 0) + 1;
    }
    return counts;
  }, [votes]);

  const caughtId = room?.caught_id;

  async function handleCastVote(targetId) {
    if (!uid) return;
    if (myVote) return;
    if (!targetId) return;
    try {
      await castVoteToServer({ roomCode, targetId });
      setMyVote(targetId);
    } catch (e) {
      Alert.alert('Could not cast vote', e?.message || 'Unknown error');
    }
  }

  async function handleTallyVotes() {
    if (!isHost) return;
    try {
      await rpcHostTallyVotes(roomCode);
    } catch (e) {
      Alert.alert('Could not tally votes', e?.message || 'Unknown error');
    }
  }

  async function submitGuess() {
    if (caughtId !== uid) return;
    const raw = guess.trim();
    if (!raw) return;
    try {
      await rpcImposterSubmitGuess(roomCode, raw);
    } catch (e) {
      Alert.alert('Could not submit guess', e?.message || 'Unknown error');
    }
  }

  function renderVotingPhase() {
    // FIX: All players in the room are eligible to vote
    const voterTotalEligible = players?.length || 0;
    const totalVoted = votes?.length || 0;

    // Show all players except yourself as voting targets
    const voteRowPlayers = (players || []).filter((p) => p.user_id !== uid);

    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>Vote</Text>
        <Text style={styles.subtitle}>Who do you think is the imposter?</Text>
        <Text style={styles.voteCount}>
          {totalVoted} / {voterTotalEligible} voted
        </Text>

        <View style={{ gap: 10, marginTop: 20 }}>
          {voteRowPlayers.map((p) => {
            const targetId = p.user_id;
            const isMine = myVote === targetId;

            return (
              <TouchableOpacity
                key={targetId}
                activeOpacity={0.75}
                onPress={() => handleCastVote(targetId)}
                disabled={!!myVote}
                style={[
                  styles.voteRow,
                  isMine ? styles.voteRowSelected : null,
                  !!myVote && !isMine ? { opacity: 0.75 } : null,
                ]}
              >
                <Avatar name={p?.name} />
                <Text style={styles.voteRowName} numberOfLines={1}>
                  {p?.name}
                </Text>
                {isMine ? <Text style={styles.checkMark}>✓</Text> : <View style={{ width: 20 }} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {isHost ? (
          <View style={{ marginTop: 24 }}>
            <PrimaryButton title="Tally Votes" onPress={handleTallyVotes} />
          </View>
        ) : (
          <Text style={styles.centerMuted}>Waiting for host to tally…</Text>
        )}
      </ScrollView>
    );
  }

  function renderGuessingPhase() {
    const caughtPlayerName =
      room?.caught_player_name ||
      (players || []).find((p) => p.user_id === caughtId)?.name ||
      'Unknown';

    const amIImposter = caughtId === uid;

    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>Caught!</Text>
        <Text style={[styles.subtitle, { color: COLORS.danger, fontSize: 24 }]}>
          {caughtPlayerName}
        </Text>
        <Text style={styles.bodyText}>
          {amIImposter ? 'You are the imposter! Guess the word to still win:' : 'The imposter gets one chance to guess the word…'}
        </Text>

        {amIImposter ? (
          <View style={{ width: '100%', gap: 12, marginTop: 20 }}>
            <TextInput
              value={guess}
              onChangeText={setGuess}
              placeholder="Type the word…"
              placeholderTextColor={COLORS.muted}
              style={styles.input}
              autoCapitalize="none"
            />
            <PrimaryButton title="Submit Guess" onPress={submitGuess} disabled={!guess.trim()} />
          </View>
        ) : (
          <Text style={styles.centerMuted}>Waiting for the imposter's guess…</Text>
        )}
      </ScrollView>
    );
  }

  function renderResultPhase() {
    const townWins = room?.result_winner === 'town';
    const caughtPlayerName = room?.caught_player_name || 'Unknown';
    const revealedWord = room?.result_word || room?.word || '';
    const guessed = room?.imposter_guess || '';
    const correctGuess = room?.result_winner === 'imposter';

    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.winnerBanner}>
          <Text style={styles.winnerEmoji}>{townWins ? '🛡️' : '🕵️'}</Text>
          <Text style={[styles.winnerTitle, { color: townWins ? COLORS.success : COLORS.danger }]}>
            {townWins ? 'Town Wins!' : 'Imposter Wins!'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>THE WORD WAS</Text>
          <Text style={styles.wordReveal}>{revealedWord}</Text>
          <Text style={styles.cardSub}>Theme: {room?.theme}</Text>
        </View>

        <View style={[styles.card, styles.cardImposter]}>
          <Text style={styles.cardLabel}>THE IMPOSTER WAS</Text>
          <Text style={[styles.imposterName, { color: COLORS.danger }]}>{caughtPlayerName}</Text>
          {guessed ? (
            <Text style={styles.guessLine}>
              Guessed: "{guessed}" {correctGuess ? '✓ correct!' : '✗ wrong'}
            </Text>
          ) : null}
        </View>

        {isHost ? (
          <View style={{ width: '100%', marginTop: 24 }}>
            <PrimaryButton
              title="Play Again"
              onPress={async () => {
                try {
                  await rpcHostPlayAgain(roomCode);
                } catch (e) {
                  Alert.alert('Could not reset game', e?.message || 'Unknown error');
                }
              }}
            />
          </View>
        ) : (
          <Text style={styles.centerMuted}>Waiting for the host to start again…</Text>
        )}
      </ScrollView>
    );
  }

  if (!room) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.muted}>Loading voting…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.leaveBtn} onPress={() => navigation.replace('Home')}>
          <Text style={styles.leaveBtnText}>← Leave</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game Over</Text>
        <View style={{ width: 60 }} />
      </View>

      {phase === 'voting' ? renderVotingPhase() : null}
      {phase === 'guessing' ? renderGuessingPhase() : null}
      {phase === 'result' ? renderResultPhase() : null}
      {(phase === 'lobby' || phase === 'roles') && (
        <View style={styles.center}>
          <Text style={styles.muted}>Preparing new game…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 10 : Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 15,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  leaveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  leaveBtnText: {
    color: COLORS.danger,
    fontWeight: '900',
    fontSize: 13,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muted: {
    color: COLORS.muted,
    fontWeight: '900',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 12,
  },
  heading: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  voteCount: {
    color: COLORS.primaryLight,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
  },
  voteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 15,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  voteRowSelected: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(124,58,237,0.08)',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
  },
  voteRowName: {
    flex: 1,
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 16,
  },
  checkMark: {
    color: COLORS.primaryLight,
    fontWeight: '900',
    fontSize: 18,
  },
  centerMuted: {
    color: COLORS.muted,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 30,
    fontSize: 14,
  },
  btnBase: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
  },
  btnFilled: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  btnOutlined: {
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderColor: COLORS.primary,
  },
  btnText: {
    fontWeight: '900',
    fontSize: 16,
  },
  btnTextFilled: {
    color: COLORS.bg,
  },
  btnTextOutlined: {
    color: COLORS.primaryLight,
  },
  input: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  bodyText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 10,
  },
  winnerBanner: {
    alignItems: 'center',
    gap: 4,
  },
  winnerEmoji: {
    fontSize: 80,
  },
  winnerTitle: {
    fontSize: 36,
    fontWeight: '900',
    textAlign: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  cardImposter: {
    borderColor: 'rgba(239,68,68,0.45)',
  },
  cardLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  wordReveal: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
  },
  cardSub: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  imposterName: {
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
  },
  guessLine: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
