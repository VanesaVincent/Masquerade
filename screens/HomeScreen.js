import React, { useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { createRoom, getRoom, getUid, joinRoom } from '../supabase';
import { generateRoomCode } from '../gameData';

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

function PrimaryButton({ title, onPress, disabled, outlined, style }) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btnBase,
        outlined ? styles.btnOutlined : styles.btnFilled,
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[styles.btnText, outlined ? styles.btnTextOutlined : styles.btnTextFilled]}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation, route }) {
  const [view, setView] = useState('home'); // home | create | join
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeHint, setCodeHint] = useState(false);

  const joinCodeParam = route?.params?.joinCode;

  useEffect(() => {
    if (joinCodeParam) {
      setCode(joinCodeParam);
      setCodeHint(true);
      setView('join');
    }
  }, [joinCodeParam]);

  const uid = getUid();

  const isValidName = useMemo(() => name.trim().length > 0 && name.trim().length <= 20, [name]);
  const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

  async function handleCreate() {
    if (!uid) return;
    if (!isValidName) {
      Alert.alert('Invalid name', 'Please enter a name up to 20 characters.');
      return;
    }

    try {
      setLoading(true);
      const roomCode = generateRoomCode();
      await createRoom({ roomCode, hostId: uid, hostName: name.trim() });
      navigation.replace('Lobby', { roomCode });
    } catch (e) {
      Alert.alert('Could not create game', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!uid) return;
    const finalName = name.trim();
    const finalCode = normalizedCode;
    if (!finalName || finalName.length > 20) {
      Alert.alert('Invalid name', 'Please enter a name up to 20 characters.');
      return;
    }
    if (!finalCode || finalCode.length !== 6) {
      Alert.alert('Invalid code', 'Please enter a 6-character room code.');
      return;
    }

    try {
      setLoading(true);
      const room = await getRoom(finalCode);
      if (!room || room.phase !== 'lobby') {
        Alert.alert('Game already started', 'This room is not accepting joins anymore.');
        return;
      }
      await joinRoom({ roomCode: finalCode, userId: uid, name: finalName });

      navigation.replace('Lobby', { roomCode: finalCode });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('Join error:', e);
      Alert.alert('Could not join game', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  if (view === 'home') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>MASQUERADE</Text>
          <Text style={styles.heroSubtitle}>Who is the imposter?</Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton title="Create Room" onPress={() => setView('create')} disabled={loading} style={{ width: '100%' }} />
          <PrimaryButton title="Join Room" onPress={() => setView('join')} disabled={loading} outlined style={{ width: '100%' }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topLinkRow}>
        <TouchableOpacity
          onPress={() => {
            setView('home');
            setCode('');
            setCodeHint(false);
          }}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      {view === 'create' ? (
        <View style={styles.form}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
            maxLength={20}
            autoCapitalize="words"
          />

          <PrimaryButton title={loading ? 'Creating…' : 'Create Game'} onPress={handleCreate} disabled={!isValidName || loading} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
            maxLength={20}
            autoCapitalize="words"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Room code</Text>
          {codeHint ? <Text style={styles.codeHint}>Code filled from shared link</Text> : null}

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="ABC123"
            placeholderTextColor={COLORS.muted}
            style={styles.codeInput}
            maxLength={6}
            autoCapitalize="characters"
            keyboardType="default"
          />

          <PrimaryButton title={loading ? 'Joining…' : 'Join Game'} onPress={handleJoin} disabled={loading || !isValidName || normalizedCode.length !== 6} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 24,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  heroTitle: {
    color: COLORS.primaryLight,
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  heroSubtitle: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    marginBottom: 24,
  },
  btnBase: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  btnFilled: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  btnOutlined: {
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  btnTextFilled: {
    color: COLORS.bg,
  },
  btnTextOutlined: {
    color: COLORS.primaryLight,
  },
  topLinkRow: {
    paddingTop: 40,
    paddingBottom: 10,
    marginBottom: 8,
    zIndex: 10,
  },
  backText: {
    color: COLORS.primaryLight,
    fontWeight: '900',
  },
  form: {
    width: '100%',
    gap: 8,
    paddingTop: 16,
  },
  label: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 6,
  },
  codeHint: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '900',
    marginTop: -2,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  codeInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
});

