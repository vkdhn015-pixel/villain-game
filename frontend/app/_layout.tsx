import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { LogBox, View, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

const VIDEO = require('../assets/videos/intro.mp4');

function MobileVideoSplash({ onFinish }: { onFinish: () => void }) {
  const player = useVideoPlayer(VIDEO, (player) => {
    player.loop = false;
    player.muted = false;
    player.play();
  });

  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      onFinish();
    });

    return () => subscription.remove();
  }, [player, onFinish]);

  return (
    <View style={styles.splash}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
  );
}

function WebVideoSplash({ onFinish }: { onFinish: () => void }) {
  const videoSource = typeof VIDEO === 'number'
    ? VIDEO
    : VIDEO?.uri || VIDEO;

  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 15000);

    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.splash}>
      <video
        autoPlay
        muted
        playsInline
        controls={false}
        onEnded={onFinish}
        src={videoSource}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const [showCustomSplash, setShowCustomSplash] = useState(true);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  const finishSplash = () => {
    setShowCustomSplash(false);
  };

  if (!loaded && !error) {
    return null;
  }

  if (showCustomSplash) {
    if (Platform.OS === 'web') {
      return <WebVideoSplash onFinish={finishSplash} />;
    }

    return <MobileVideoSplash onFinish={finishSplash} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: '#F7F8FA',
            },
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },

  video: {
    width: '100%',
    height: '100%',
  },
});