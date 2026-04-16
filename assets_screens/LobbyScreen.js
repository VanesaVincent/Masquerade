import React, { useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';

import { getPlayers, getRoom, getUid, rpcHostAssignRoles, setTheme, leaveRoom } from '../supabase';
import { THEME_NAMES } from '../gameData';

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

function Avatar({ name }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

function Chip({ active, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
      ]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function LobbyScreen({ navigation, route }) {
  const roomCode = route?.params?.roomCode;
  const uid = getUid();

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);

  const hasReplacedToRoleRef = useRef(false);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const r = await getRoom(roomCode);
        const ps = await getPlayers(roomCode);
        if (!alive) return;

        setRoom(r);
        setPlayers(ps);

        if (r.phase === 'lobby') {
          hasReplacedToRoleRef.current = false;
        }

        if (r.phase === 'roles' && !hasReplacedToRoleRef.current) {
          hasReplacedToRoleRef.current = true;
          navigation.replace('Role', { roomCode });
        }
      } catch (e) {
        // Swallow transient errors
      }
    }

    refresh();
    const id = setInterval(refresh, 1000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [roomCode, navigation]);

  const isHost = room && uid && room.host_id === uid;
  const playerCount = players?.length || 0;

  async function setThemeClient(themeName) {
    try {
      await setTheme(roomCode, themeName);
    } catch (e) {
      Alert.alert('Could not update theme', e?.message || 'Unknown error');
    }
  }

  async function handleAssignRoles() {
    try {
      await rpcHostAssignRoles(roomCode);
    } catch (e) {
      Alert.alert('Could not assign roles', e?.message || 'Unknown error');
    }
  }

  async function handleLeave() {
    try {
      await leaveRoom(roomCode);
    } catch (e) {
      // Even if it fails, we want to go back
    } finally {
      navigation.replace('Home');
    }
  }

  if (!room) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.muted}>Loading room…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const shareUrl = `masquerade://join/${roomCode}`;
  const inviteMessage =
    `Join my Masquerade game!\n\n` +
    `Tap: masquerade://join/${roomCode}\n\n` +
    `Or enter code: ${roomCode}`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
          <Text style={styles.leaveBtnText}>← Leave</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Room Lobby</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => Share.share({ message: inviteMessage, url: shareUrl })}
          style={styles.shareCard}
        >
          <Text style={styles.shareIcon}>🔗</Text>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.shareTitle}>Share Invite Link</Text>
            <Text style={styles.shareSubtitle}>Friends tap the link to join instantly</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.manualCode}>
          {roomCode}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PLAYERS ({playerCount})</Text>
          <View style={{ gap: 10 }}>
            {players.map((p) => (
              <View key={p?.user_id} style={styles.playerRow}>
                <Avatar name={p?.name} />
                <Text style={styles.playerName} numberOfLines={1}>
                  {p?.name}
                </Text>
                {room.host_id === p?.user_id ? <Text style={styles.hostBadge}>HOST</Text> : null}
              </View>
            ))}
          </View>
        </View>

        {isHost ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PICK A THEME</Text>
              <View style={styles.chipsRow}>
                {THEME_NAMES.map((t) => (
                  <Chip key={t} active={room.theme === t} label={t} onPress={() => setThemeClient(t)} />
                ))}
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleAssignRoles}
              disabled={!room.theme || playerCount < 3}
              style={[
                styles.assignBtn,
                (!room.theme || playerCount < 3) && { opacity: 0.4 },
              ]}
            >
              <Text style={styles.assignBtnText}>Assign Roles</Text>
            </TouchableOpacity>

            {(!room.theme || playerCount < 3) ? (
              <Text style={styles.centerMuted}>
                {!room.theme ? 'Pick a theme' : 'Need at least 3 players'} to start
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.centerMuted}>Waiting for the host to assign roles…</Text>
        )}
      </ScrollView>
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 15,
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
  shareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(124,58,237,0.10)',
    padding: 18,
    gap: 14,
  },
  shareIcon: {
    fontSize: 28,
    color: COLORS.primaryLight,
  },
  shareTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '900',
  },
  shareSubtitle: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  manualCode: {
    color: COLORS.accent,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
    fontSize: 20,
    marginVertical: 10,
  },
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
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
  playerName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  hostBadge: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: COLORS.accent,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    color: COLORS.accent,
    fontWeight: '900',
    fontSize: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipInactive: {
    backgroundColor: 'rgba(124,58,237,0.06)',
    borderColor: COLORS.border,
  },
  chipText: {
    fontWeight: '900',
    fontSize: 13,
  },
  chipTextActive: {
    color: COLORS.bg,
  },
  chipTextInactive: {
    color: COLORS.muted,
  },
  assignBtn: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 10,
  },
  assignBtnText: {
    color: COLORS.bg,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
  },
  centerMuted: {
    color: COLORS.muted,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: 5,
    fontSize: 13,
  },
});
