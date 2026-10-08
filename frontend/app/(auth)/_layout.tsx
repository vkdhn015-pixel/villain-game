import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export default function AuthLayout() {
  const [showVideo, setShowVideo] = useState(true);

  const player = useVideoPlayer(
    require('../../assets/videos/intro.mp4'),
    (player) => {
      player.loop = false;
      player.muted = false;
      player.play();
    }
  );

  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      setShowVideo(false);
    });

    return () => subscription.remove();
  }, [player]);

  if (showVideo) {
    return (
      <View style={styles.container}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
        />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: '#fff',
        },
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  video: {
    width: '100%',
    height: '100%',
  },
});