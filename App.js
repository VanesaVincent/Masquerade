import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Linking, ActivityIndicator, View, StyleSheet } from 'react-native';

import { signInAnon } from './supabase';

import HomeScreen from './screens/HomeScreen';
import LobbyScreen from './screens/LobbyScreen';
import RoleScreen from './screens/RoleScreen';
import GameScreen from './screens/GameScreen';
import VotingScreen from './screens/VotingScreen';

const Stack = createNativeStackNavigator();

function extractJoinCode(url) {
  if (!url) return null;
  const match = url.match(/join\/([A-Z0-9]{6})/i);
  return match ? match[1].toUpperCase() : null;
}

export default function App() {
  const navRef = useNavigationContainerRef();
  const [user, setUser] = useState(null);
  const [initialJoinCode, setInitialJoinCode] = useState(null);
  const [linkResolved, setLinkResolved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    signInAnon()
      .then((u) => setUser(u))
      .catch((err) => {
        console.error("Supabase Auth Error:", err);
        setError("Failed to connect to game server. Please check your internet.");
      });
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const url = await Linking.getInitialURL();
        if (!isMounted) return;
        const code = extractJoinCode(url);
        if (code) setInitialJoinCode(code);
      } finally {
        if (isMounted) setLinkResolved(true);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const code = extractJoinCode(url);
      if (!code) return;
      const nav = navRef.current;
      if (nav && nav.isReady()) {
        nav.navigate('Home', { joinCode: code });
      } else {
        setInitialJoinCode(code);
      }
    });

    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, [navRef]);

  const initialHomeParams = useMemo(() => ({ joinCode: initialJoinCode || null }), [initialJoinCode]);

  const ready = user && linkResolved;

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} initialParams={initialHomeParams} />
        <Stack.Screen name="Lobby" component={LobbyScreen} />
        <Stack.Screen name="Role" component={RoleScreen} />
        <Stack.Screen name="Game" component={GameScreen} />
        <Stack.Screen name="Voting" component={VotingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
