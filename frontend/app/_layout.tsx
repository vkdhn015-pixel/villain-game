import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { LogBox, View, Image, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const [showCustomSplash, setShowCustomSplash] = useState(true);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();

      const timer = setTimeout(() => {
        setShowCustomSplash(false);
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [loaded, error]);

  // Fonts load hone tak kuch render nahi hoga
  if (!loaded && !error) {
    return null;
  }

  // VILLAIN11 full-screen startup image
  if (showCustomSplash) {
    return (
      <View style={styles.splash}>
        <Image
          source={require('../assets/images/splash-image.png')}
          style={styles.splashImage}
          resizeMode="cover"
        />
      </View>
    );
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

  splashImage: {
    width: '100%',
    height: '100%',
  },
});