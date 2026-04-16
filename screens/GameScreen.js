import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, SafeAreaView, StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';

import {
  getPlayers,
  getRoom,
  getUid,
  rpcHostNextRound,
  rpcHostStartVoting,
} from '../supabase';
import { ROUND_DURATION_SECONDS } from '../gameData';

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

function Button({ title, onPress, disabled, variant, style }) {
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
        style
      ]}
    >
      <Text style={[styles.btnText, filled ? styles.btnTextFilled : styles.btnTextOutlined]}>{title}</Text>
    </TouchableOpacity>
  );
}

function formatMMSS(secondsTotal) {
  const s = Math.max(0, secondsTotal);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const mmStr = String(mm).padStart(2, '0');
  const ssStr = String(ss).padStart(2, '0');
  return `${mmStr}:${ssStr}`;
}

export default function GameScreen({ navigation, route }) {
  const roomCode = route?.params?.roomCode;
  const uid = getUid();

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);

  const [remaining, setRemaining] = useState(ROUND_DURATION_SECONDS);
  const [timeDone, setTimeDone] = useState(false);

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const hasReplacedToVotingRef = useRef(false);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const r = await getRoom(roomCode);
        const ps = await getPlayers(roomCode);
        if (!alive) return;

        setRoom(r);
        setPlayers(ps);

        if (r.phase === 'voting' && !hasReplacedToVotingRef.current) {
          hasReplacedToVotingRef.current = true;
          navigation.replace('Voting', { roomCode });
        }
      } catch (e) {
        // SILENT FAIL: If the network blips, don't show a red screen.
        // The next interval (in 1s) will try again automatically.
        console.log("Polling skip due to network:", e.message);
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
    if (!room || room.phase !== 'game') return;
    if (!room.timer_started_at) return;

    setTimeDone(false);

    const startedAtMs = new Date(room.timer_started_at).getTime();

    const computeRemaining = () => {
      const elapsedSec = Math.floor((Date.now() - startedAtMs) / 1000);
      const rem = ROUND_DURATION_SECONDS - elapsedSec;
      return rem;
    };

    setRemaining(Math.max(0, computeRemaining()));

    const interval = setInterval(() => {
      const rem = computeRemaining();
      if (rem <= 0) {
        setRemaining(0);
        setTimeDone(true);
        clearInterval(interval);
      } else {
        setRemaining(rem);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [room?.timer_started_at, room?.round, room?.phase]);

  const isHost = room && uid && room.host_id === uid;

  const showFirstSpeaker = room && room.round === 1 && room.first_speaker_id;
  const isYouFirst = showFirstSpeaker && room.first_speaker_id === uid;
  const firstSpeakerName = showFirstSpeaker
    ? (players?.find((p) => p.user_id === room.first_speaker_id)?.name || 'Unknown')
    : null;

  useEffect(() => {
    if (!showFirstSpeaker) return;
    pulseAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [showFirstSpeaker, isYouFirst]);

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  const timerColor =
    timeDone ? COLORS.danger : remaining <= 20 ? COLORS.danger : remaining <= 60 ? COLORS.accent : COLORS.success;

  const instruction =
    room?.round === 1
      ? "Take turns giving clues. Don't say the word directly!"
      : 'Continue discussing. Who seems like the imposter?';

  async function handleNextRound() {
    if (!room || !isHost) return;
    try {
      await rpcHostNextRound(roomCode);
      setTimeDone(false);
      setRemaining(ROUND_DURATION_SECONDS);
    } catch (e) {
      Alert.alert('Could not start next round', e?.message || 'Unknown error');
    }
  }

  async function handleVoteNow() {
    if (!room || !isHost) return;
    try {
      await rpcHostStartVoting(roomCode);
    } catch (e) {
      Alert.alert('Could not start voting', e?.message || 'Unknown error');
    }
  }

  if (!room) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.muted}>Loading round…</Text>
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
        <Text style={styles.headerTitle}>In Game</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.roundLabel}>ROUND {room.round}</Text>
        <Text style={styles.themeName}>{room.theme}</Text>

        {showFirstSpeaker ? (
          <Animated.View
            style={[
              styles.banner,
              isYouFirst ? styles.bannerYou : styles.bannerOther,
              { opacity: pulseOpacity },
            ]}
          >
            <Text style={styles.bannerEmoji}>🎤</Text>
            {isYouFirst ? (
              <>
                <Text style={styles.bannerYouTitle}>You go first!</Text>
                <Text style={styles.bannerSub}>Give a clue about the word without saying it.</Text>
              </>
            ) : (
              <>
                <Text style={styles.bannerOtherTitle}>
                  {firstSpeakerName} goes first
                </Text>
                <Text style={styles.bannerSub}>Listen carefully to their clue.</Text>
              </>
            )}
          </Animated.View>
        ) : null}

        <View style={styles.timerArea}>
          <Text style={[styles.timerText, { color: timerColor }]}>
            {formatMMSS(remaining)}
          </Text>
          {timeDone ? <Text style={styles.timeUpText}>Time's up!</Text> : null}
        </View>

        <Text style={styles.instruction}>{timeDone ? '' : instruction}</Text>

        {isHost && (
          <View style={styles.hostControls}>
            {timeDone ? (
              <>
                <Text style={styles.prompt}>What would you like to do?</Text>
                <Button
                  title={'↻  Next Round'}
                  onPress={handleNextRound}
                  variant="outlined"
                />
                <Button
                  title={'🗳  Vote Now'}
                  onPress={handleVoteNow}
                  variant="filled"
                />
              </>
            ) : (
              <Button
                title={'🗳  End Discussion & Vote'}
                onPress={handleVoteNow}
                variant="outlined"
                style={{ marginTop: 20 }}
              />
            )}
          </View>
        )}

        {!isHost && timeDone && (
          <Text style={styles.centerMuted}>Waiting for the host to decide…</Text>
        )}
      </View>
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
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 10,
  },
  roundLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  themeName: {
    color: COLORS.primaryLight,
    fontSize: 16,
    fontWeight: '900',
    marginTop: -4,
  },
  banner: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 6,
    alignItems: 'flex-start',
  },
  bannerYou: {
    backgroundColor: '#1A1200',
    borderColor: COLORS.accent,
  },
  bannerOther: {
    backgroundColor: '#1A1040',
    borderColor: COLORS.primary,
  },
  bannerEmoji: {
    fontSize: 22,
    marginBottom: -2,
  },
  bannerYouTitle: {
    color: COLORS.accent,
    fontWeight: '900',
    fontSize: 22,
    marginTop: 4,
  },
  bannerOtherTitle: {
    color: COLORS.primaryLight,
    fontWeight: '900',
    fontSize: 18,
    marginTop: 4,
  },
  bannerSub: {
    color: COLORS.muted,
    fontWeight: '700',
    fontSize: 13,
    marginTop: 2,
  },
  timerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  timerText: {
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: 1,
  },
  timeUpText: {
    color: COLORS.muted,
    fontWeight: '900',
    fontSize: 14,
  },
  instruction: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    minHeight: 22,
    marginTop: -6,
  },
  hostControls: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
    paddingBottom: 24,
  },
  prompt: {
    color: COLORS.text,
    fontWeight: '900',
    fontSize: 16,
    marginBottom: -2,
    textAlign: 'center',
  },
  btnBase: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 16,
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
    letterSpacing: 0.4,
  },
  btnTextFilled: {
    color: COLORS.bg,
  },
  btnTextOutlined: {
    color: COLORS.primaryLight,
  },
  centerMuted: {
    color: COLORS.muted,
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 40,
  },
});
