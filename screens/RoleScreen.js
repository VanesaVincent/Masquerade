import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getPlayers, getRoom, getUid, rpcHostStartGame, setHasSeenRole } from '../supabase';

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

export default function RoleScreen({ navigation, route }) {
  const roomCode = route?.params?.roomCode;
  const uid = getUid();

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);

  const hasReplacedToGameRef = useRef(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  const [revealed, setRevealed] = useState(false);

  const myPlayer = players?.find((p) => p.user_id === uid) || {};
  const isImposter = !!myPlayer?.is_imposter;
  const hasSeenRole = !!myPlayer?.has_seen_role;

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const r = await getRoom(roomCode);
        const ps = await getPlayers(roomCode);
        if (!alive) return;

        setRoom(r);
        setPlayers(ps);

        if (r.phase === 'game' && !hasReplacedToGameRef.current) {
          hasReplacedToGameRef.current = true;
          navigation.replace('Game', { roomCode });
        }
      } catch (e) {
        // transient errors while polling
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
    if (hasSeenRole) {
      flipAnim.setValue(1);
      setRevealed(true);
    } else {
      flipAnim.setValue(0);
      setRevealed(false);
    }
  }, [hasSeenRole]);

  const cardRotationFront = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const cardRotationBack = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const totalPlayers = players?.length || 0;
  const readyCount = useMemo(() => {
    return (players || []).reduce((n, p) => n + (p?.has_seen_role ? 1 : 0), 0);
  }, [players]);
  const allSeen = totalPlayers > 0 && readyCount === totalPlayers;

  const isHost = room && uid && room.host_id === uid;

  async function handleReveal() {
    if (revealed) return;
    if (!uid) return;

    Animated.spring(flipAnim, {
      toValue: 1,
      friction: 6,
      tension: 40,
      useNativeDriver: false,
    }).start(() => {
      setRevealed(true);
    });

    try {
      await setHasSeenRole(roomCode);
    } catch (e) {
      Alert.alert('Could not reveal role', e?.message || 'Unknown error');
    }
  }

  async function handleStartGame() {
    if (!isHost) return;
    if (!allSeen) return;

    try {
      await rpcHostStartGame(roomCode);
    } catch (e) {
      Alert.alert('Could not start game', e?.message || 'Unknown error');
    }
  }

  if (!room) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.muted}>Loading roles…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const themeName = room.theme || 'Unknown';
  const roleWord = room.word;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.replace('Home')}>
          <Text style={styles.backText}>← Leave Room</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.heading}>Your Role</Text>
        <Text style={styles.subheading}>Tap the card to reveal — keep it secret!</Text>

        <View style={styles.cardWrap}>
          <TouchableOpacity activeOpacity={0.9} onPress={handleReveal} disabled={revealed}>
            <View style={styles.cardOuter}>
              <Animated.View
                style={[
                  styles.cardFace,
                  styles.frontFace,
                  { transform: [{ perspective: 1000 }, { rotateY: cardRotationFront }] },
                ]}
              >
                <Text style={styles.frontEmoji}>🎭</Text>
                <Text style={styles.frontText}>Tap to reveal</Text>
              </Animated.View>

              <Animated.View
                style={[
                  styles.cardFace,
                  isImposter ? styles.backImposter : styles.backRegular,
                  { transform: [{ perspective: 1000 }, { rotateY: cardRotationBack }] },
                ]}
              >
                {isImposter ? (
                  <>
                    <Text style={styles.frontEmoji}>🕵️</Text>
                    <Text style={styles.backLabel}>YOU ARE THE</Text>
                    <Text style={styles.imposterTitle}>IMPOSTER</Text>
                    <Text style={styles.smallText}>Blend in. Don't get caught.</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.frontEmoji}>💬</Text>
                    <Text style={styles.backLabel}>THE WORD IS</Text>
                    <Text style={styles.wordText}>{roleWord}</Text>
                    <Text style={styles.smallText}>Theme: {themeName}</Text>
                  </>
                )}
              </Animated.View>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.statusText}>
          {readyCount} / {totalPlayers} Players ready
        </Text>

        <View style={styles.bottomArea}>
          {isHost ? (
            <PrimaryButton
              title={allSeen ? 'Start Game →' : 'Waiting for everyone…'}
              onPress={handleStartGame}
              disabled={!allSeen}
              variant="filled"
            />
          ) : (
            allSeen ? <Text style={styles.centerMuted}>Waiting for the host to start…</Text> : null
          )}
          <View style={{ height: 10 }} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 24,
  },
  topRow: {
    paddingTop: 50,
    paddingBottom: 10,
  },
  backText: {
    color: COLORS.primaryLight,
    fontWeight: '900',
    fontSize: 14,
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
    gap: 14,
  },
  heading: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.text,
  },
  subheading: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: 320,
  },
  cardWrap: {
    marginTop: 12,
  },
  cardOuter: {
    width: 280,
    height: 380,
    position: 'relative',
  },
  cardFace: {
    width: 280,
    height: 380,
    borderRadius: 18,
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backfaceVisibility: 'hidden',
  },
  frontFace: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backRegular: {
    backgroundColor: '#0B0B18',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  backImposter: {
    backgroundColor: '#1A1200',
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  frontEmoji: {
    fontSize: 72,
    marginBottom: 10,
  },
  frontText: {
    color: COLORS.muted,
    fontWeight: '900',
    fontSize: 14,
  },
  backLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  wordText: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 6,
  },
  imposterTitle: {
    color: COLORS.danger,
    fontSize: 34,
    fontWeight: '900',
    marginTop: 6,
    letterSpacing: 1,
    textAlign: 'center',
  },
  smallText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 240,
  },
  statusText: {
    marginTop: 18,
    color: COLORS.muted,
    fontWeight: '900',
    textAlign: 'center',
  },
  bottomArea: {
    marginTop: 'auto',
    width: '100%',
    gap: 10,
    alignItems: 'center',
    paddingBottom: 20,
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
    textAlign: 'center',
    fontSize: 14,
  },
});
