import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, AccessibilityInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'react-native';
import Svg, { Path, G, Circle, Text as SvgText, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps, withTiming, withSequence, withRepeat, withDelay,
  withSpring, Easing, cancelAnimation, FadeInDown, FadeIn, ZoomIn, runOnJS,
} from 'react-native-reanimated';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { PrimaryButton, inputStyle } from '@/src/ui';
import { api } from '@/src/api';
import LiveBetFeed from '@/src/components/LiveBetFeed';
import * as Haptics from 'expo-haptics';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const TRAIL_START_X = 10;   // Plane Image जितना left
const TRAIL_START_Y_OFFSET = 6; // Plane Image जितना bottom
const PLANE_TAIL_OFFSET_X = 18; // plane के अंदर tail कहां है (image के अंदर left से)
const PLANE_TAIL_OFFSET_Y = 60; // plane के अंदर tail कहां है (image के अंदर top से, 100 height में से)

const TITLES: Record<string, { title: string; color: string; icon: any }> = {
  crash: { title: 'Crash', color: '#FF6B6B', icon: 'rocket' },
  aviator: { title: 'Aviator', color: '#5B8CFF', icon: 'airplane' },
  dice: { title: 'Lucky Dice', color: '#FFB020', icon: 'dice' },
  spin: { title: 'Spin Wheel', color: '#2ECA7F', icon: 'sync-circle' },
  'andar-bahar': { title: 'Andar Bahar', color: '#4A4A4A', icon: 'albums' },
  'dragon-tiger': {
  title: 'Dragon Tiger',
  color: '#D4AF37',
  icon: 'paw'
},
  teenpatti: { title: 'Teen Patti', color: '#E53935', icon: 'grid' },
  'number-king': { title: 'Number King', color: '#FF7E67', icon: 'apps' },
  plinko: { title: 'Plinko', color: '#FF9A9E', icon: 'game-controller' },
  mines: { title: 'Mines', color: '#FF6B6B', icon: 'flame' },
  sudoku: { title: 'Sudoku', color: '#5B8CFF', icon: 'grid-outline' },
  match3: { title: 'Match Three', color: '#FFB020', icon: 'shapes' },
  bullseye: { title: 'Bull\'s Eye', color: '#2ECA7F', icon: 'radio-button-on' },
  tournament: { title: 'Weekly Cup', color: '#E53935', icon: 'trophy' },
};

const SPIN_SEGMENTS = [0, 1.5, 0, 2, 0, 3, 0, 5];
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function wedgePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

// ---- Small particle burst for celebrations (lightweight, max 10) ----
function Particles({ show, color }: { show: number; color: string }) {
  if (!show) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {Array.from({ length: 10 }).map((_, i) => (
        <Particle key={`${show}-${i}`} index={i} color={color} />
      ))}
    </View>
  );
}
function Particle({ index, color }: { index: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(1, { duration: 750, easing: Easing.out(Easing.quad) }); }, []);
  const angle = (index / 10) * Math.PI * 2;
  const st = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [
      { translateX: Math.cos(angle) * 90 * p.value },
      { translateY: Math.sin(angle) * 90 * p.value },
      { scale: 1 - p.value * 0.5 },
    ],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', top: '46%', left: '48%', width: 10, height: 10, borderRadius: 5, backgroundColor: color }, st]} />
  );
}

export default function GameScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: string }>();
  const gt = String(type || 'crash');

  if (gt === 'coming-soon') return <ComingSoon router={router} />;

  const meta = TITLES[gt] || TITLES.crash;
  const [bet, setBet] = useState('10');
  const [cashOut, setCashOut] = useState('2.0');
  const [pick, setPick] = useState<'over' | 'under'>('over');
  const [threshold, setThreshold] = useState(50);
  const [abPick, setAbPick] = useState<'andar' | 'bahar'>('andar');

  const [numberPick, setNumberPick] = useState(5);
  const [abCards, setAbCards] = useState<{
    andar: any[];
    bahar: any[];
  }>({
    andar: [],
    bahar: [],
  });
  const [minePicks, setMinePicks] = useState(3);

  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 490, height: 428 });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<string>('READY');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [liveMult, setLiveMult] = useState('1.00');
  const [revealCount, setRevealCount] = useState(0); // for mines/cards sequential reveal
  const [celebrate, setCelebrate] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [winSegIdx, setWinSegIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<Array<{ win: boolean; label: string }>>([]);
  const [flying, setFlying] = useState(false);
  const isCrash = gt === 'crash' || gt === 'aviator';
  const isDragonTiger = gt === 'dragon-tiger';

const [dtStatus, setDtStatus] =
  useState<'waiting' | 'revealed'>('waiting');

const [dtTimeLeft, setDtTimeLeft] = useState(5);

const [dtRoundId, setDtRoundId] =
  useState<string | null>(null);

const [dtDragonCard, setDtDragonCard] =
  useState<any>(null);

const [dtTigerCard, setDtTigerCard] =
  useState<any>(null);

const [dtWinner, setDtWinner] =
  useState<'dragon' | 'tiger' | null>(null);

const [dtPick, setDtPick] =
  useState<'dragon' | 'tiger' | null>(null);

const [dtBetPlaced, setDtBetPlaced] =
  useState(false);

const [dtTotalBet, setDtTotalBet] =
  useState(0);

const [dtPlayers, setDtPlayers] =
  useState(0);

const dtRoundRef = useRef<string | null>(null);

  const multTimer = useRef<any>(null);
  const revealTimer = useRef<any>(null);
  const cdTimer = useRef<any>(null);
  const climbTimer = useRef<any>(null);
  const pollTimer = useRef<any>(null);
  const roundRef = useRef<{ id: string; start: number; auto: number | null } | null>(null);
  const cashingRef = useRef(false);

  // reanimated shared values
  const fly = useSharedValue(0);        // crash/aviator climb 0..1
  const rotate = useSharedValue(0);     // spin wheel deg
  const diceRot = useSharedValue(0);    // dice rotation
  const diceBounce = useSharedValue(0); // dice bounce
  const bgShift = useSharedValue(0);    // dynamic bg
  const cardFlip = useSharedValue(0);   // 0..1 flip
  const cardDeal1 = useSharedValue(0);
  const cardDeal2 = useSharedValue(0);
  const cardDeal3 = useSharedValue(0);
  const ballDrop = useSharedValue(0);   // plinko 0..1
  const plinkoX = useSharedValue(0);
  const plinkoY = useSharedValue(0);
  const plinkoScale = useSharedValue(1);
  const dartFly = useSharedValue(0);    // bullseye 0..1
  const resultPulse = useSharedValue(1);
  const glowIntensity = useSharedValue(0.3);
  const shake = useSharedValue(0);
  const dtDragonScale = useSharedValue(1);
const dtTigerScale = useSharedValue(1);

const dtDragonAnimatedStyle = useAnimatedStyle(() => ({
  transform: [{ scale: dtDragonScale.value }],
}));

const dtTigerAnimatedStyle = useAnimatedStyle(() => ({
  transform: [{ scale: dtTigerScale.value }],
}));

  useEffect(() => {
    api.me().then((m) => setBalance(m?.balance ?? 0));
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);
    
     // ---- Global live crash polling (plane always flies, bet anytime during waiting) ----
  const [liveStatus, setLiveStatus] = useState<'waiting' | 'flying' | 'crashed'>('waiting');
  const [liveRoundId, setLiveRoundId] = useState<string | null>(null);
  const [myLiveBetPlaced, setMyLiveBetPlaced] = useState(false);
  const livePollTimer = useRef<any>(null);
  const lastRoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isCrash) return;
    livePollTimer.current = setInterval(async () => {
      try {
        const st = await api.liveState();
        if (st.round_id && st.round_id !== lastRoundIdRef.current) {
          lastRoundIdRef.current = st.round_id;
          setMyLiveBetPlaced(false);
        }
        setLiveRoundId(st.round_id || null);
        if (st.status === 'waiting') {
          setLiveStatus('waiting');
          setDisplay('READY');
          setFlying(false);
          fly.value = 0;
          setResult(null);
        } else if (st.status === 'flying') {
          setLiveStatus('flying');
          setFlying(true);
          setDisplay('FLYING');
          setLiveMult(st.multiplier.toFixed(2));
          fly.value = Math.min(1, (st.multiplier - 1) / 10);
          glowIntensity.value = withRepeat(withSequence(withTiming(0.9, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1, true);
        } else if (st.status === 'crashed') {
          if (liveStatus !== 'crashed') {
            shake.value = withSequence(withTiming(-10, { duration: 60 }), withTiming(10, { duration: 60 }), withTiming(0, { duration: 60 }));
            glowIntensity.value = withTiming(0, { duration: 300 });
            try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
          }
          setLiveStatus('crashed');
          setFlying(false);
          setDisplay(`CRASHED @ ${st.crash_point?.toFixed(2)}x`);
        }
      } catch {}
    }, 300);
    return () => { if (livePollTimer.current) clearInterval(livePollTimer.current); };
  }, [isCrash, liveStatus]);

  const clearTimers = useCallback(() => {
    [multTimer, revealTimer, cdTimer, climbTimer, pollTimer].forEach((t) => { if (t.current) { clearInterval(t.current); clearTimeout(t.current); t.current = null; } });
  }, []);

  useEffect(() => () => { clearTimers(); [fly, rotate, diceRot, diceBounce, bgShift, cardFlip, cardDeal1, cardDeal2, cardDeal3, ballDrop, dartFly].forEach(cancelAnimation); }, []);

  useEffect(() => {
  if (!isDragonTiger) return;

  let mounted = true;

  const pollDragonTiger = async () => {
    try {
      const st = await api.dragonTigerLiveState();

      if (!mounted) return;

      // New round
      if (
        st.round_id &&
        st.round_id !== dtRoundRef.current
      ) {
        dtRoundRef.current = st.round_id;

        setDtRoundId(st.round_id);
        setDtBetPlaced(false);
        setDtPick(null);
        setDtDragonCard(null);
        setDtTigerCard(null);
        setDtWinner(null);
      }
      

      setDtStatus(
        st.status === 'revealed'
          ? 'revealed'
          : 'waiting'
      );

      setDtTimeLeft(
        Number(st.time_left ?? 0)
      );

      setDtTotalBet(
        Number(st.round_total_bet ?? 0)
      );

      setDtPlayers(
        Number(st.round_player_count ?? 0)
      );

      if (st.status === 'waiting') {
        setDisplay(
          `BET NOW · ${Number(
            st.time_left ?? 0
          ).toFixed(1)}s`
        );
        dtDragonScale.value = withSpring(1);
        dtTigerScale.value = withSpring(1);
      }

      if (st.status === 'revealed') {
        setDtDragonCard(
          st.dragon_card ?? null
        );

        setDtTigerCard(
          st.tiger_card ?? null
        );

        setDtWinner(
          st.winner ?? null
        );

        if (st.winner === 'dragon') {
          dtDragonScale.value = withSpring(1.25);
          dtTigerScale.value = withSpring(0.85);
        } else if (st.winner === 'tiger') {
          dtDragonScale.value = withSpring(0.85);
          dtTigerScale.value = withSpring(1.25);
        }

        setDisplay(
          st.winner === 'dragon'
            ? '🐉 DRAGON WINS'
            : '🐯 TIGER WINS'
        );

        // Refresh wallet after server settlement
        try {
          const me = await api.me();

          if (me?.balance != null) {
            setBalance(me.balance);
          }
        } catch {}
      }

    } catch (error) {
      console.log(
        'Dragon Tiger live state error:',
        error
      );
    }
  };

  pollDragonTiger();

  const timer = setInterval(
    pollDragonTiger,
    300
  );

  return () => {
    mounted = false;
    clearInterval(timer);
  };
}, [isDragonTiger]);

  const finishRound = (res: any, label: string) => {
    setDisplay(label);
    setHistory((h) => [{ win: res.win, label }, ...h].slice(0, 8));
    if (res.win) {
      setCelebrate((c) => c + 1);
      resultPulse.value = withSequence(withTiming(1.08, { duration: 160 }), withSpring(1));
    }
    setBusy(false);
  };
const runAnimationFor = (res: any) => {
  console.log("🔥🔥 RUN ANIMATION CALLED");
  console.log("🔥 GAME TYPE:", gt);
  console.log("🔥 RESPONSE:", JSON.stringify(res));
  const r = res.result;
    // Reduced motion: skip visuals, show result immediately
  if (reduceMotion) {

    if (gt === 'andar-bahar') {
      setAbCards({
        andar: Array.isArray(r?.andar_cards)
          ? r.andar_cards
          : [],
        bahar: Array.isArray(r?.bahar_cards)
          ? r.bahar_cards
          : [],
       });
    }

  finishRound(res, labelFor(gt, res));
  return;
}

    if (gt === 'spin') {
      const idx = r.segment_index || 0;
      const finalDeg = 360 * 5 + (360 - (idx * 45 + 22.5));
      rotate.value = 0;
      setWinSegIdx(null);
      rotate.value = withSequence(
        withTiming(finalDeg + 15, { duration: 2400, easing: Easing.out(Easing.cubic) }),
        withTiming(finalDeg, { duration: 220, easing: Easing.inOut(Easing.quad) })
      );
      let tickCount = 0;
      const tickInterval = setInterval(() => {
        tickCount++;
        try { Haptics.selectionAsync(); } catch {}
        if (tickCount > 18) clearInterval(tickInterval);
      }, 130);
      cdTimer.current = setTimeout(() => {
        clearInterval(tickInterval);
        setWinSegIdx(idx);
        try { Haptics.notificationAsync(res.win ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning); } catch {}
        finishRound(res, res.win ? `WON x${r.segment_multiplier}` : 'NO WIN');
      }, 2650);
    } else if (gt === 'dice') {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
      diceRot.value = withTiming(360 * 5, { duration: 10000, easing: Easing.out(Easing.cubic) });
      diceBounce.value = withSequence(
        withTiming(-40, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 250, easing: Easing.bounce }),
        withTiming(-20, { duration: 200 }),
        withTiming(0, { duration: 250, easing: Easing.bounce }),
      );
      cdTimer.current = setTimeout(() => {
        diceRot.value = 0;
        try { Haptics.notificationAsync(res.win ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning); } catch {}
        finishRound(res, `ROLLED ${r.roll}`);
      }, 10050);
   } else if (gt === 'teenpatti') {

  // ==============================
  // TEEN PATTI - SEPARATE ANIMATION
  // ==============================

  cardDeal1.value = 0;
  cardDeal2.value = 0;
  cardDeal3.value = 0;

  cardDeal1.value = withSequence(
    withTiming(1, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    }),
    withDelay(
      120,
      withTiming(1, {
        duration: 420,
        easing: Easing.out(Easing.cubic),
      })
    )
  );

  cardDeal2.value = withDelay(
    180,
    withSequence(
      withTiming(1, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      }),
      withDelay(
        120,
        withTiming(1, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
        })
      )
    )
  );

  cardDeal3.value = withDelay(
    360,
    withSequence(
      withTiming(1, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      }),
      withDelay(
        120,
        withTiming(1, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
        })
      )
    )
  );

  try {
    Haptics.impactAsync(
      Haptics.ImpactFeedbackStyle.Light
    );
  } catch {}

  cdTimer.current = setTimeout(() => {

    try {
      Haptics.notificationAsync(
        res.win
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch {}

    finishRound(
      res,
      res.win
        ? `YOU WIN - ${r.player_hand || ''}`
        : `YOU LOSE - ${r.player_hand || ''}`
    );

  }, 1500);


} else if (gt === 'andar-bahar') {

  const abResult = res?.result ?? {};

  const winner = String(
    abResult.winner || 'andar'
  ).toLowerCase();

  const andarCards = Array.isArray(abResult.andar_cards)
    ? abResult.andar_cards
    : [];

  const baharCards = Array.isArray(abResult.bahar_cards)
    ? abResult.bahar_cards
    : [];

  console.log(
    '🃏 AB FINAL DATA:',
    JSON.stringify({
      joker: abResult.joker_card,
      andar: andarCards,
      bahar: baharCards,
      winner,
    })
  );

  // Directly put complete cards into state.
  // No interval / animation dependency.
  setAbCards({
    andar: andarCards,
    bahar: baharCards,
  });

  try {
    Haptics.notificationAsync(
      res.win
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning
    );
  } catch {}

  // Small delay only for winner animation.
  cdTimer.current = setTimeout(() => {

    finishRound(
      res,
      `WINNER: ${winner.toUpperCase()}`
    );

  }, 300);

  return;
    } else if (gt === 'number-king') {
      // quick number shuffle
      let ticks = 0;
      setLiveMult(String(Math.floor(Math.random() * 10)));
      multTimer.current = setInterval(() => {
        ticks++;
        setLiveMult(String(Math.floor(Math.random() * 10)));
        if (ticks > 14) { clearInterval(multTimer.current); multTimer.current = null; setLiveMult(String(r.roll)); finishRound(res, `ROLLED ${r.roll}`); }
      }, 70);
} else if (gt === 'plinko') {
  const slot = Math.max(0, Math.min(8, Number(r.slot ?? 4)));

  // Reset
  plinkoX.value = 0;
  plinkoY.value = 0;
  plinkoScale.value = 1;

  /*
   * 8 bounce decisions.
   * The server result decides the final slot.
   * This only animates the visual path to that slot.
   */
  const targetX = (slot - 4) * 30;

  const directions: number[] = [];
  let currentX = 0;

  for (let i = 0; i < 8; i++) {
    const remaining = 8 - i;
    const distance = targetX - currentX;

    let direction =
      distance > 8 ? 1 :
      distance < -8 ? -1 :
      Math.random() > 0.5 ? 1 : -1;

    // Near the end, guide the animation toward the server slot.
    if (remaining <= 2) {
      direction = distance >= 0 ? 1 : -1;
    }

    directions.push(direction);
    currentX += direction * 30;
  }

  // Correct final visual position.
  const correction = targetX - currentX;

  plinkoY.value = withTiming(0, { duration: 1 });

  // Bounce down through the peg rows.
  const xAnimations: any[] = [];
  const yAnimations: any[] = [];

  let x = 0;

  for (let i = 0; i < directions.length; i++) {
    const dx = directions[i] * 30;
    x += dx;

    xAnimations.push(
      withTiming(x, {
        duration: 220,
        easing: Easing.out(Easing.quad),
      })
    );

    // Small vertical bounce between pegs.
    yAnimations.push(
      withTiming((i + 1) * 31 - 7, {
        duration: 200,
        easing: Easing.inOut(Easing.quad),
      })
    );
  }

  // Final correction to exact slot.
  xAnimations.push(
    withTiming(targetX, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    })
  );

  yAnimations.push(
    withTiming(285, {
      duration: 250,
      easing: Easing.in(Easing.quad),
    })
  );

  plinkoX.value = xAnimations.length
    ? withSequence(...xAnimations)
    : withTiming(correction);

  plinkoY.value = withSequence(...yAnimations);

  plinkoScale.value = withSequence(
    withTiming(1.15, { duration: 90 }),
    withTiming(0.92, { duration: 100 }),
    withTiming(1, { duration: 100 })
  );

  // Result after ball reaches bottom.
  cdTimer.current = setTimeout(() => {
    try {
      Haptics.notificationAsync(
        res.win
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch {}

    finishRound(res, `x${r.multiplier}`);
  }, 1250);


    } else if (gt === 'mines') {
      setRevealCount(0);
      let i = 0;
      revealTimer.current = setInterval(() => {
        i++; setRevealCount(i);
        if (i >= (r.revealed?.length || minePicks)) { clearInterval(revealTimer.current); revealTimer.current = null; finishRound(res, res.win ? `SAFE x${r.multiplier}` : 'BOOM!'); }
      }, 320);
    } else if (gt === 'match3') {
      // reels spin briefly
      let ticks = 0;
      multTimer.current = setInterval(() => {
        ticks++;
        if (ticks > 12) { clearInterval(multTimer.current); multTimer.current = null; finishRound(res, (r.board || []).join(' ')); }
        else setDisplay('...');
      }, 80);
    } else if (gt === 'bullseye') {
      dartFly.value = 0;
      dartFly.value = withTiming(1, { duration: 900, easing: Easing.in(Easing.cubic) });
      cdTimer.current = setTimeout(() => finishRound(res, (r.ring || 'MISS').toUpperCase()), 950);
    } else {
      cdTimer.current = setTimeout(() => finishRound(res, labelFor(gt, res)), 900);
    }
  };

  // ---- Interactive Crash / Aviator ----
  const CURVE_A = 0.35, CURVE_B = 0.09;
  const multAt = (elapsedS: number) => 1 + CURVE_A * elapsedS + CURVE_B * elapsedS * elapsedS;

  const endCrashRound = () => {
    if (climbTimer.current) { clearInterval(climbTimer.current); climbTimer.current = null; }
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    setFlying(false);
    bgShift.value = withTiming(0, { duration: 300 });
  };

  const onCrash = (crashPoint?: number) => {
    if (cashingRef.current) return;
    cashingRef.current = true;
    endCrashRound();
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
    shake.value = withSequence(withTiming(-10, { duration: 60 }), withTiming(10, { duration: 60 }), withTiming(0, { duration: 60 }));
    glowIntensity.value = withTiming(0, { duration: 300 });
    // explosion: drop back down
   
    setResult({ win: false, payout: 0, result: {} });
    finishRound({ win: false }, crashPoint ? `CRASHED @ ${crashPoint.toFixed(2)}x` : 'CRASHED');
    if (roundRef.current) api.crashSettle(roundRef.current.id).catch(() => {});
  };

  const doCashout = async (atMult: number) => {
    if (cashingRef.current || !roundRef.current) return;
    cashingRef.current = true;
    const rid = roundRef.current.id;
    endCrashRound();
    try {
      const res = await api.crashCashout(rid, Number(atMult.toFixed(2)));
      setBalance(res.balance);
      if (res.win) {
        setResult({ win: true, payout: res.payout, result: { multiplier: res.multiplier } });
        setLiveMult(res.multiplier.toFixed(2));
        finishRound({ win: true }, `CASHED @ ${res.multiplier}x`);
      } else {
        setResult({ win: false, payout: 0, result: {} });
        finishRound({ win: false }, `CRASHED @ ${(res.crash_point || 0).toFixed(2)}x`);
      }
    } catch (e: any) {
      setError(e.message || 'Cash-out failed');
      finishRound({ win: false }, 'ERROR');
    }
  };

  const startCrashRound = async (amt: number) => {
    try {
      const auto = parseFloat(cashOut);
      const autoVal = !isNaN(auto) && auto > 1 ? auto : null;
      const res = await api.crashStart(amt, gt, autoVal);
      setBalance(res.balance);
      roundRef.current = { id: res.round_id, start: Date.now(), auto: autoVal };
      cashingRef.current = false;
      setResult(null);
      setFlying(true);
      setLiveMult('1.00');
      setDisplay('FLYING');
      fly.value = 0;
      bgShift.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
      glowIntensity.value = withRepeat(withSequence(withTiming(0.9, { duration: 500 }), withTiming(0.3, { duration: 500 })), -1, true);

      // local climb + auto cash-out
      climbTimer.current = setInterval(() => {
        if (!roundRef.current) return;
        const t = (Date.now() - roundRef.current.start) / 1000;
        const m = multAt(t);
        setLiveMult(m.toFixed(2));
        fly.value = Math.min(1, (m - 1) / 10);
        if (roundRef.current.auto && m >= roundRef.current.auto && !cashingRef.current) {
          doCashout(roundRef.current.auto);
        }
      }, 40);

      // poll server for crash (server is authoritative, crash point hidden)
      pollTimer.current = setInterval(async () => {
        if (!roundRef.current || cashingRef.current) return;
        try {
          const st = await api.crashStatus(roundRef.current.id);
          if (st.status === 'crashed') onCrash(st.crash_point);
        } catch {}
      }, 350);
    } catch (e: any) {
      setError(e.message || 'Could not start round'); setDisplay('ERROR'); setBusy(false); setFlying(false);
    }
  };

  const placeDragonTigerBet = async (
  side: 'dragon' | 'tiger'
) => {
  if (busy) return;

  if (dtBetPlaced) {
    setError(
      'You already placed a bet this round'
    );
    return;
  }

  if (dtStatus !== 'waiting') {
    setError(
      'Betting is closed. Wait for next round.'
    );
    return;
  }

  const amount = Number(bet);

  if (!amount || amount <= 0) {
    setError('Enter a valid bet amount');
    return;
  }

  if (amount > balance) {
    setError('Insufficient balance');
    return;
  }

  try {
    setBusy(true);
    setError(null);

    const result =
      await api.dragonTigerBet(
        amount,
        side
      );

    setBalance(
      Number(result.balance ?? balance)
    );

    setDtRoundId(
      result.round_id ?? dtRoundId
    );

    setDtPick(side);
    setDtBetPlaced(true);

    setDisplay(
      `BET PLACED · ${side.toUpperCase()}`
    );

  } catch (e: any) {
    console.log(
      'Dragon Tiger bet error:',
      e
    );

    setError(
      e?.message ||
      'Could not place bet'
    );

  } finally {
    setBusy(false);
  }
};

  const play = async () => {
    if (busy) return; // prevent duplicate taps
    const amt = parseFloat(bet) || 0;
    if (amt <= 0) { setError('Enter a valid bet amount'); return; }
    if (amt > balance) { setError('Insufficient balance'); return; }

    if (isCrash) {
      if (liveStatus !== 'waiting') { setError('Betting closed — wait for next round'); return; }
      setError(null); setBusy(true);
      try {
        const auto = parseFloat(cashOut);
        const autoVal = !isNaN(auto) && auto > 1 ? auto : null;
        const res = await api.liveBet(amt, autoVal);
        setBalance(res.balance);
        setMyLiveBetPlaced(true);
        setBusy(false);
      } catch (e: any) {
        setError(e.message || 'Could not place bet');
        setBusy(false);
      }
      return;
    }

    setError(null); setBusy(true); setResult(null); setDisplay('...');
    clearTimers();

    const startRound = async () => {
      if (isCrash) { await startCrashRound(amt); return; }
      try {
        const params: any = {};
        if (gt === 'dice') { params.pick = pick; params.threshold = threshold; }
        if (gt === 'andar-bahar') params.pick = abPick;
        if (gt === 'number-king') params.number = numberPick;
        if (gt === 'mines') params.picks = minePicks;
        const res = await api.play({
  game_type: gt,
  bet_amount: amt,
  params,
});

console.log(
  "🔥 PLAY RESPONSE:",
  JSON.stringify(res, null, 2)
);

setBalance(Number(res?.balance ?? balance ?? 0));

// ================================
// ANDAR BAHAR NORMALIZATION
// ================================
if (gt === 'andar-bahar') {
  const rr = res?.result ?? {};

  console.log(
    "🔥🔥 BACKEND AB RESULT:",
    JSON.stringify(rr, null, 2)
  );

  /*
   * Backend may return:
   *   andar_cards: [...]
   *   bahar_cards: [...]
   *
   * OR the current backend response:
   *   andar_card: {...}
   *   bahar_card: null
   *
   * Support BOTH formats.
   */

  const andarCards: any[] = Array.isArray(rr.andar_cards)
    ? rr.andar_cards
    : rr.andar_card
      ? [rr.andar_card]
      : [];

  const baharCards: any[] = Array.isArray(rr.bahar_cards)
    ? rr.bahar_cards
    : rr.bahar_card
      ? [rr.bahar_card]
      : [];

  const winner = String(
    rr.winner || ''
  ).toLowerCase();

  // Debug
  console.log('🔥🔥 ANDAR BAHAR FINAL');
  console.log('🃏 JOKER:', rr.joker_card);
  console.log('🃏 ANDAR COUNT:', andarCards.length);
  console.log('🃏 BAHAR COUNT:', baharCards.length);
  console.log('🃏 ANDAR CARDS:', JSON.stringify(andarCards));
  console.log('🃏 BAHAR CARDS:', JSON.stringify(baharCards));
  console.log('🃏 WINNER:', winner);

  // ---------------------------------------------------
  // SAVE REAL CARDS TO UI STATE
  // ---------------------------------------------------
  setAbCards({
    andar: andarCards,
    bahar: baharCards,
  });

  // ---------------------------------------------------
  // SAVE COMPLETE RESULT
  // ---------------------------------------------------
  const finalResult = {
    ...res,
    result: {
      ...rr,

      // Always expose arrays to the UI
      andar_cards: andarCards,
      bahar_cards: baharCards,

      // Keep original backend values too
      andar_card: rr.andar_card ?? null,
      bahar_card: rr.bahar_card ?? null,

      joker_card: rr.joker_card ?? null,
      winner: winner,
    },
  };

  setResult(finalResult);

  // ---------------------------------------------------
  // FINISH ROUND
  // ---------------------------------------------------
  finishRound(
    finalResult,
    winner
      ? `WINNER: ${winner.toUpperCase()}`
      : 'ROUND COMPLETE'
  );

  // IMPORTANT:
  // Do NOT call runAnimationFor() here.
  // Cards are already received from backend.
  return;
}

setResult(res);
runAnimationFor(res);
      } catch (e: any) {
        setError(e.message || 'Something went wrong'); setDisplay('ERROR'); setBusy(false);
      }
    };

    // Countdown for crash/aviator, else straight to round
   
      startRound();
       };

  // ---- animated styles ----
const PLANE_TRAVEL_X = 220;
const PLANE_TRAVEL_Y = 150;

function getPlanePoint(progress: number, height: number) {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  const centerProgress = Math.min(p / 0.35, 1);
  const hoverX = centerProgress >= 1 ? Math.sin(p * Math.PI * 6) * 5 : 0;
  const hoverY = centerProgress >= 1 ? Math.sin(p * Math.PI * 10) * 10 : 0;

  const baseX = TRAIL_START_X + PLANE_TAIL_OFFSET_X;
  const baseY = height - TRAIL_START_Y_OFFSET - PLANE_TAIL_OFFSET_Y;

  const x = baseX + centerProgress * PLANE_TRAVEL_X + hoverX;
  const y = baseY - centerProgress * PLANE_TRAVEL_Y - hoverY;

  return { x, y, centerProgress, hoverX, hoverY };
}

  function buildTrailPath(progress: number, width: number, height: number) {
  'worklet';
  const startX = TRAIL_START_X + PLANE_TAIL_OFFSET_X;
  const startY = height - TRAIL_START_Y_OFFSET;
  const { x: currentX, y: currentY } = getPlanePoint(progress, height);

  const controlX = currentX;
  const controlY = startY;

  return `
    M ${startX} ${startY}
    Q ${controlX} ${controlY} ${currentX} ${currentY}
    L ${currentX} ${startY}
    L ${startX} ${startY}
    Z
  `;
}

function buildTrailLinePath(progress: number, width: number, height: number) {
  'worklet';
  const startX = TRAIL_START_X + PLANE_TAIL_OFFSET_X;
  const startY = height - TRAIL_START_Y_OFFSET;
  const { x: currentX, y: currentY } = getPlanePoint(progress, height);

  const controlX = currentX;
  const controlY = startY;

  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${currentX} ${currentY}`;
}

const trailFillProps = useAnimatedProps(() => ({
  d: buildTrailPath(fly.value, 490, 428),
}));

const trailGlowProps = useAnimatedProps(() => ({
  d: buildTrailLinePath(fly.value, 490, 428),
}));

const flyStyle = useAnimatedStyle(() => {
  const p = Math.min(1, fly.value);
  const { centerProgress, hoverX, hoverY } = getPlanePoint(p, 428);
  const rotation = centerProgress >= 1 ? Math.sin(p * Math.PI * 10) * 2 : -centerProgress * 8;

  return {
    transform: [
      { translateX: centerProgress * PLANE_TRAVEL_X + hoverX + shake.value * 0.4 },
      { translateY: -centerProgress * PLANE_TRAVEL_Y + hoverY + shake.value },
      { rotate: `${rotation}deg` },
    ],
  };
});
  const bgStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -bgShift.value * 40 }] }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate.value}deg` }] }));
  const diceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: diceBounce.value }, { rotate: `${diceRot.value}deg` }] }));
  const cardStyle1 = useAnimatedStyle(() => ({
  opacity: cardDeal1.value,
  transform: [
    { perspective: 800 },
    { translateY: (1 - cardDeal1.value) * 35 },
    { scale: 0.85 + cardDeal1.value * 0.15 },
    { rotateZ: `${(1 - cardDeal1.value) * -7}deg` },
    { rotateY: `${(1 - cardDeal1.value) * 180}deg` },
  ],
}));

const cardStyle2 = useAnimatedStyle(() => ({
  opacity: cardDeal2.value,
  transform: [
    { perspective: 800 },
    { translateY: (1 - cardDeal2.value) * 35 },
    { scale: 0.85 + cardDeal2.value * 0.15 },
    { rotateZ: `${(1 - cardDeal2.value) * 7}deg` },
    { rotateY: `${(1 - cardDeal2.value) * 180}deg` },
  ],
}));

const cardStyle3 = useAnimatedStyle(() => ({
  opacity: cardDeal3.value,
  transform: [
    { perspective: 800 },
    { translateY: (1 - cardDeal3.value) * 35 },
    { scale: 0.85 + cardDeal3.value * 0.15 },
    { rotateY: `${(1 - cardDeal3.value) * 180}deg` },
  ],
}));


  const ballStyle = useAnimatedStyle(() => ({
  transform: [
    { translateX: plinkoX.value },
    { translateY: plinkoY.value },
    { scale: plinkoScale.value },
   ],
  }));
  const dartStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - dartFly.value * 0.7 }], opacity: 0.4 + dartFly.value * 0.6 }));
  const resultStyle = useAnimatedStyle(() => ({ transform: [{ scale: resultPulse.value }] }));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <LinearGradient colors={[meta.color + 'DD', meta.color]}>
        <SafeAreaView edges={['top']} style={styles.h}>
          <Pressable onPress={() => router.back()} testID="game-back"><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={styles.title}>{meta.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="wallet-outline" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }} testID="game-balance">₹{Number(balance ?? 0).toFixed(2)}</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        {/* Live bet feed */}
        <LiveBetFeed game={gt} />
        {/* Game stage */}
        <View style={styles.stage}>
          <LinearGradient 
          colors={['#1F2937', '#111827']} 
           style={[
            styles.stageBg,  
            (gt === 'aviator' || gt === 'crash') && styles.crashAviatorStage
            ]}
            >
            {/* dynamic drifting bg dots for crash/aviator */}
            {(gt === 'crash' || gt === 'aviator') && (
              <Animated.View style={[StyleSheet.absoluteFill, bgStyle, { pointerEvents: 'none' }]}>
                {[...Array(6)].map((_, i) => (
                  <View key={i} style={{ position: 'absolute', top: 20 + i * 34, left: 40 + i * 48, width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' }} />
                ))}
              </Animated.View>
            )}

            {countdown !== null ? (
              <Animated.Text key={countdown} entering={ZoomIn.duration(300)} style={styles.countdown} testID="countdown">{countdown}</Animated.Text>
            ) : (
              <>
                {(gt === 'crash' || gt === 'aviator') && (
                  <>
                     <Image
                      source={require('../../assets/images/space1.png')}
                      style={styles.gameSpaceBackground}
                      resizeMode="cover"
                     />
                  {liveStatus !== 'waiting' && (   
                    <Svg width="109%" height="97%" style={{ position: 'absolute' }} pointerEvents="none">
  <Defs>
    <SvgLinearGradient id="trailFade" x1="0%" y1="100%" x2="100%" y2="0%">
      <Stop offset="0%" stopColor="#FF003C" stopOpacity={0.5} />
      <Stop offset="100%" stopColor="#FF003C" stopOpacity={0.08} />
    </SvgLinearGradient>
  </Defs>

  <AnimatedPath animatedProps={trailFillProps} fill="url(#trailFade)" />

  <AnimatedPath animatedProps={trailGlowProps} fill="none" stroke="#FF003C" strokeWidth={22} strokeLinecap="round" opacity={0.2} />
  <AnimatedPath animatedProps={trailGlowProps} fill="none" stroke="#a80210" strokeWidth={6} strokeLinecap="round" opacity={1} />
  <AnimatedPath animatedProps={trailGlowProps} fill="none" stroke="#f80324" strokeWidth={8} strokeLinecap="round" opacity={0.95} />
</Svg>
                  )}

                    <Animated.View style={[{ position: 'absolute', bottom: 6, left: 10, }, flyStyle]}>
                      {gt === 'aviator' ? (
                      <Image source={require('../../assets/images/plane.png')} style={{ width: 100, height: 100, resizeMode: 'contain' }} />
                    ) : gt === 'crash' ? (
                      <Image source={require('../../assets/images/rocket.png')} style={{ width: 100, height: 100, resizeMode: 'contain' }} />
                    ) : (
                      <Ionicons name={meta.icon} size={72} color="#fff" />
                    )}
                    </Animated.View>
                    {(flying || busy) && <Text style={[styles.liveMult, !flying && result && !result.win && { color: '#FF4D4F' }]}>{liveMult}x</Text>}
                  </>
                )}

                {isDragonTiger && (
  <View style={styles.dtTable}>

    {/* HEADER */}
    <View style={styles.dtHeader}>

      <View>
        <Text style={styles.dtTitle}>
          DRAGON TIGER
        </Text>

        <Text style={styles.dtSubtitle}>
          HIGH CARD WINS • 1.9X
        </Text>
      </View>

      <View style={styles.dtTimerBox}>

        <Text style={styles.dtTimerLabel}>
          {dtStatus === 'waiting'
            ? 'BETTING'
            : 'RESULT'}
        </Text>

        <Text style={styles.dtTimer}>
          {dtStatus === 'waiting'
            ? `${Math.max(
                0,
                dtTimeLeft
              ).toFixed(1)}s`
            : '✓'}
        </Text>

      </View>

    </View>


    {/* CARDS */}
    <View style={styles.dtCardsRow}>

      {/* DRAGON */}
      <View
        style={[
          styles.dtSide,
          dtWinner === 'dragon' &&
            styles.dtWinnerSide,
        ]}
      >

        <Text style={styles.dtSideTitle}>
          🐉 DRAGON
        </Text>

        <Animated.View
  style={[
    styles.dtCharacterBox,
    dtWinner === 'dragon' && styles.dtWinnerCharacter,
    dtDragonAnimatedStyle,
  ]}
>
  <Image
    source={require('../../assets/images/dragon.png')}
    style={styles.dtDragonImage}
    resizeMode="contain"
  />
</Animated.View>

        <Pressable
          disabled={
            dtStatus !== 'waiting' ||
            dtBetPlaced ||
            busy
          }
          onPress={() =>
            placeDragonTigerBet(
              'dragon'
            )
          }
          style={[
            styles.dtBetButton,
            styles.dtDragonButton,
            dtPick === 'dragon' &&
              styles.dtSelectedButton,
          ]}
        >

          <Text style={styles.dtBetText}>
            {dtPick === 'dragon'
              ? 'BET PLACED'
              : 'BET DRAGON'}
          </Text>

        </Pressable>

      </View>


      {/* VS */}
      <View style={styles.dtVs}>
        <Text style={styles.dtVsText}>
          VS
        </Text>
      </View>


      {/* TIGER */}
      <View
        style={[
          styles.dtSide,
          dtWinner === 'tiger' &&
            styles.dtWinnerSide,
        ]}
      >

        <Text style={styles.dtSideTitle}>
          🐯 TIGER
        </Text>

        <Animated.View
  style={[
    styles.dtCharacterBox,
    dtWinner === 'tiger' && styles.dtWinnerCharacter,
    dtTigerAnimatedStyle,
  ]}
>
  <Image
    source={require('../../assets/images/tiger.png')}
    style={styles.dtTigerImage}
    resizeMode="contain"
  />
</Animated.View>

        <Pressable
          disabled={
            dtStatus !== 'waiting' ||
            dtBetPlaced ||
            busy
          }
          onPress={() =>
            placeDragonTigerBet(
              'tiger'
            )
          }
          style={[
            styles.dtBetButton,
            styles.dtTigerButton,
            dtPick === 'tiger' &&
              styles.dtSelectedButton,
          ]}
        >

          <Text style={styles.dtBetText}>
            {dtPick === 'tiger'
              ? 'BET PLACED'
              : 'BET TIGER'}
          </Text>

        </Pressable>

      </View>

    </View>


    {/* RESULT */}
    {dtStatus === 'revealed' &&
      dtWinner && (
        <View
          style={styles.dtResultBox}
        >

          <Text
            style={styles.dtResult}
          >
            {dtWinner === 'dragon'
              ? '🐉 DRAGON WINS'
              : '🐯 TIGER WINS'}
          </Text>

          {dtBetPlaced &&
            dtPick === dtWinner && (
              <Text
                style={styles.dtWin}
              >
                🎉 YOU WIN • 1.90X
              </Text>
            )}

          {dtBetPlaced &&
            dtPick !== dtWinner && (
              <Text
                style={styles.dtLose}
              >
                BET LOST
              </Text>
            )}

        </View>
      )}


    {/* LIVE STATS */}
    <View style={styles.dtStats}>

      <Text style={styles.dtStat}>
        TOTAL ₹{dtTotalBet.toFixed(2)}
      </Text>

      <Text style={styles.dtStat}>
        PLAYERS {dtPlayers}
      </Text>

      <Text style={styles.dtStat}>
        1.90X
      </Text>

    </View>

  </View>
)}

                {gt === 'spin' && (
  <View
    style={{
      width: '100%',
      height: 260,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >

    {/* TOP POINTER */}
    <View
      style={{
        position: 'absolute',
        top: 8,
        zIndex: 20,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 11,
          borderRightWidth: 11,
          borderTopWidth: 22,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: '#FFFFFF',
        }}
      />

      <View
        style={{
          width: 34,
          height: 5,
          borderRadius: 5,
          backgroundColor: '#FFD700',
          marginTop: -2,
        }}
      />
    </View>

    {/* STATUS */}
    <View
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.35)',
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 20,
        zIndex: 10,
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: busy ? '#FFD700' : '#2ECA7F',
          marginRight: 6,
        }}
      />

      <Text
        style={{
          color: '#fff',
          fontSize: 9,
          fontWeight: '900',
          letterSpacing: 0.7,
        }}
      >
        {busy ? 'SPINNING' : 'READY TO SPIN'}
      </Text>
    </View>

    {/* OUTER GLOW / RIM */}
    <View
      style={{
        width: 222,
        height: 222,
        borderRadius: 111,
        backgroundColor: '#FFD700',
        padding: 7,
        shadowColor: '#FFD700',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.65,
        shadowRadius: 14,
        elevation: 12,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >

      {/* INNER DARK RIM */}
      <View
        style={{
          width: 208,
          height: 208,
          borderRadius: 104,
          backgroundColor: '#151515',
          padding: 5,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >

        {/* WHEEL */}
        <Animated.View
          style={[
            {
              width: 198,
              height: 198,
              borderRadius: 99,
              overflow: 'hidden',
              backgroundColor: '#fff',
            },
            spinStyle,
          ]}
        >

          <Svg
            width={198}
            height={198}
            viewBox="0 0 198 198"
          >
            <G>

              {SPIN_SEGMENTS.map((m, i) => {
                const seg = 360 / SPIN_SEGMENTS.length;
                const start = i * seg;
                const end = start + seg;
                const mid = (start + end) / 2;

                const isWin =
                  !busy &&
                  winSegIdx === i;

                const labelPos =
                  polarToCartesian(
                    99,
                    99,
                    64,
                    mid
                  );

                const wheelColors = [
                  '#E91E63',
                  '#FF8A00',
                  '#7C4DFF',
                  '#00A8FF',
                  '#FF3D71',
                  '#FFB300',
                  '#00C853',
                  '#9C27B0',
                ];

                return (
                  <G key={`spin-segment-${i}`}>

                    <Path
                      d={wedgePath(
                        99,
                        99,
                        97,
                        start,
                        end
                      )}
                      fill={
                        isWin
                          ? '#FFD700'
                          : wheelColors[i % wheelColors.length]
                      }
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />

                    <SvgText
                      x={labelPos.x}
                      y={labelPos.y}
                      fill="#FFFFFF"
                      fontSize={15}
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      {m === 0 ? 'LOSE' : `${m}x`}
                    </SvgText>

                  </G>
                );
              })}

              {/* CENTER CIRCLE */}
              <Circle
                cx="99"
                cy="99"
                r="34"
                fill="#151515"
                stroke="#FFD700"
                strokeWidth="5"
              />

              <Circle
                cx="99"
                cy="99"
                r="25"
                fill="#252525"
              />

              <SvgText
                x="99"
                y="96"
                fill="#FFFFFF"
                fontSize="13"
                fontWeight="900"
                textAnchor="middle"
              >
                SPIN
              </SvgText>

              <SvgText
                x="99"
                y="111"
                fill="#FFD700"
                fontSize="9"
                fontWeight="900"
                textAnchor="middle"
              >
                & WIN
              </SvgText>

            </G>
          </Svg>
        </Animated.View>
      </View>
    </View>

    {/* LAST RESULT */}
    <View
      style={{
        position: 'absolute',
        bottom: 8,
        left: 14,
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Text
        style={{
          color: 'rgba(255,255,255,0.65)',
          fontSize: 8,
          fontWeight: '800',
        }}
      >
        LAST RESULT
      </Text>

      <Text
        style={{
          color: '#FFD700',
          fontSize: 15,
          fontWeight: '900',
          marginTop: 1,
        }}
      >
        {!busy && result?.result?.segment_multiplier
          ? `${result.result.segment_multiplier}x`
          : '—'}
      </Text>
    </View>

  </View>
)}

                {gt === 'dice' && (
                  <View style={styles.diceBox}>
                    <Animated.View style={[diceStyle, styles.diceShadow]}><Ionicons name="dice" size={100} color="#fff" /></Animated.View>
                    <Animated.Text key={result?.result?.roll ?? 'x'} entering={ZoomIn.duration(300)} style={styles.rollText} testID="dice-roll">{result?.result?.roll ?? '—'}</Animated.Text>
                  </View>
                )}
                
                

                {/* {(gt === 'andar-bahar' || gt === 'teenpatti') && ( */}
                  {/* <View style={{ alignItems: 'center' }}> */}
                    {/* <View style={{ flexDirection: 'row', gap: 12 }}> */}
                      {/* {[0, 1, 2].slice(0, gt === 'teenpatti' ? 3 : 2).map((i) => ( */}
                        {/* <Animated.View key={i} style={[styles.cardBox, flipStyle]}> */}
                          {/* <Ionicons name={gt === 'teenpatti' ? 'heart' : 'albums'} size={34} color={meta.color} /> */}
                        {/* </Animated.View> */}
                      {/* ))} */}
                    {/* </View> */}
                    {/* {result && ( */}
                      {/* <Text style={{ color: '#fff', marginTop: 14, fontWeight: '800' }}> */}
                        {/* {gt === 'teenpatti' ? result.result.player_hand : `Winner: ${(result.result.winner || '').toUpperCase()}`} */}
                      {/* </Text> */}
                    {/* )} */}
                  {/* </View> */}
                {/* )} */}
              {/* =====================================================
    TEEN PATTI
===================================================== */}

{gt === 'teenpatti' && (

  <View style={styles.tpTable}>

    {/* HEADER */}
    <View style={styles.tpHeader}>

      <View>
        <Text style={styles.tpTitle}>
          TEEN PATTI
        </Text>

        <Text style={styles.tpSubtitle}>
          3 CARD SHOWDOWN
        </Text>
      </View>

      <View style={styles.tpLiveBadge}>
        <View style={styles.tpLiveDot} />

        <Text style={styles.tpLiveText}>
          {busy ? 'DEALING' : 'LIVE'}
        </Text>
      </View>

    </View>


    {/* OPPONENT */}

    <Text style={styles.tpSectionTitle}>
      OPPONENT
    </Text>

    <View style={styles.tpCardsRow}>

      {[0, 1, 2].map((i) => {

        const card =
          result?.result?.dealer_cards?.[i];

        return (
          <Animated.View
            key={`dealer-${i}-${celebrate}`}
            entering={FadeInDown
              .delay(i * 160)
              .duration(320)}
            style={styles.tpCard}
          >

            {card? (

              <View style={styles.tpCardFace}>

                <Text
                  style={[
                    styles.tpCardRank,
                    {
                      color:
                        card.suit === '♥️' ||
                        card.suit === '♦️'
                          ? '#E53935'
                          : '#111827',
                    },
                  ]}
                >
                  {card.rank}
                </Text>

                <Text
                  style={[
                    styles.tpCardSuit,
                    {
                      color:
                        card.suit === '♥️' ||
                        card.suit === '♦️'
                          ? '#E53935'
                          : '#111827',
                    },
                  ]}
                >
                  {card.suit}
                </Text>

              </View>

            ) : (

              <Image
                source={require('../../assets/images/cardbackR.png')}
                style={styles.tpCardBack}
              />

            )}

          </Animated.View>
        );

      })}

    </View>


    {/* OPPONENT HAND */}

    {!busy &&
      result?.result?.dealer_hand && (

      <View style={styles.tpHandBadge}>
        <Text style={styles.tpHandText}>
          {result.result.dealer_hand}
        </Text>
      </View>

    )}


    {/* VS */}

    <View style={styles.tpVsRow}>

      <View style={styles.tpVsLine} />

      <Animated.View
        entering={ZoomIn.duration(300)}
        style={styles.tpVs}
      >
        <Text style={styles.tpVsText}>
          VS
        </Text>
      </Animated.View>

      <View style={styles.tpVsLine} />

    </View>


    {/* PLAYER */}

    <Text style={styles.tpSectionTitle}>
      YOUR CARDS
    </Text>

    <View style={styles.tpCardsRow}>

      {[0, 1, 2].map((i) => {

        const card =
          result?.result?.player_cards?.[i];

        const dealStyle =
          i === 0
            ? cardStyle1
            : i === 1
            ? cardStyle2
            : cardStyle3;

        return (
          <Animated.View
            key={`player-${i}-${celebrate}`}
            entering={FadeInDown
              .delay(500 + i * 160)
              .duration(320)}
            style={[
              styles.tpCard,
              dealStyle,
            ]}
          >

            {card? (

              <View style={styles.tpCardFace}>

                <Text
                  style={[
                    styles.tpCardRank,
                    {
                      color:
                        card.suit === '♥️' ||
                        card.suit === '♦️'
                          ? '#E53935'
                          : '#111827',
                    },
                  ]}
                >
                  {card.rank}
                </Text>

                <Text
                  style={[
                    styles.tpCardSuit,
                    {
                      color:
                        card.suit === '♥️' ||
                        card.suit === '♦️'
                          ? '#E53935'
                          : '#111827',
                    },
                  ]}
                >
                  {card.suit}
                </Text>

              </View>

            ) : (

              <Image
                source={require('../../assets/images/cardbackR.png')}
                style={styles.tpCardBack}
              />

            )}

          </Animated.View>
        );

      })}

    </View>


    {/* PLAYER HAND */}

    {!busy &&
      result?.result?.player_hand && (

      <Animated.View
        entering={ZoomIn.duration(300)}
        style={styles.tpHandBadge}
      >

        <Text style={styles.tpHandText}>
          {result.result.player_hand}
        </Text>

      </Animated.View>

    )}

  </View>
)}  

{/* =====================================================
    ANDAR BAHAR
===================================================== */}

{gt === 'andar-bahar' && (
  <View style={styles.abTable}>

    {/* HEADER */}
    <View style={styles.abHeader}>

      <View>
        <Text style={styles.abTitle}>
          ANDAR • BAHAR
        </Text>

        <Text style={styles.abSubtitle}>
          MATCH THE JOKER
        </Text>
      </View>

      <View style={styles.abLiveBadge}>
        <View style={styles.abLiveDot} />

        <Text style={styles.abLiveText}>
          {busy ? 'DEALING' : 'LIVE'}
        </Text>
      </View>

    </View>


    {/* JOKER */}
    <View style={styles.abJokerSection}>

      <Text style={styles.abJokerLabel}>
        JOKER
      </Text>

      <View style={styles.abJokerCard}>

        {result?.result?.joker_card ? (
          <View style={styles.abCardFace}>

            <Text
              style={[
                styles.abJokerRank,
                {
                  color:
                    result.result.joker_card.suit === '♥️' ||
                    result.result.joker_card.suit === '♦️'
                      ? '#E53935'
                      : '#111827',
                },
              ]}
            >
              {result.result.joker_card.rank}
            </Text>

            <Text
              style={[
                styles.abJokerSuit,
                {
                  color:
                    result.result.joker_card.suit === '♥️' ||
                    result.result.joker_card.suit === '♦️'
                      ? '#E53935'
                      : '#111827',
                },
              ]}
            >
              {result.result.joker_card.suit}
            </Text>

          </View>
        ) : (
          <Image
            source={require('../../assets/images/joker.png')}
            style={styles.abJokerImage}
          />
        )}

      </View>

      <Text style={styles.abTargetText}>
        FIND SAME RANK
      </Text>

    </View>


    {/* ANDAR + BAHAR */}
    <View style={styles.abSides}>

      {/* ================= ANDAR ================= */}
      <View style={styles.abSide}>

        <View style={styles.abSideHeader}>

          <Text style={styles.abSideTitle}>
            ANDAR
          </Text>

          <Text style={styles.abCount}>
            {abCards.andar.length}
          </Text>

        </View>


        <View style={styles.abCardsColumn}>

          {(
  abCards.andar.length > 0
    ? abCards.andar
    : result?.result?.andar_cards?.length
      ? result.result.andar_cards
      : result?.result?.andar_card
        ? [result.result.andar_card]
        : []
).map((card: any, index: number) => (
  <Animated.View
    key={`andar-card-${index}`}
    entering={FadeInDown.delay(index * 80).duration(250)}
    style={[
      styles.abSmallCard,
      card?.rank === result?.result?.joker_card?.rank &&
        styles.abMatchCard,
    ]}
  >
    <View style={styles.abCardFace}>

      <Text
        style={[
          styles.abCardRank,
          {
            color:
              card?.suit === '♥️' ||
              card?.suit === '♦️'
                ? '#E53935'
                : '#111827',
          },
        ]}
      >
        {card?.rank}
      </Text>

      <Text
        style={[
          styles.abCardSuit,
          {
            color:
              card?.suit === '♥️' ||
              card?.suit === '♦️'
                ? '#E53935'
                : '#111827',
          },
        ]}
      >
        {card?.suit}
      </Text>

    </View>
  </Animated.View>
))}

          {/* Empty state */}
          {!busy && abCards.andar.length === 0 && (
            <Text
              style={{
                color: '#999',
                fontSize: 12,
                marginTop: 10,
              }}
            >
              No cards
            </Text>
          )}

        </View>

      </View>


      {/* ================= BAHAR ================= */}
      <View style={styles.abSide}>

        <View style={styles.abSideHeader}>

          <Text style={styles.abSideTitle}>
            BAHAR
          </Text>

          <Text style={styles.abCount}>
            {abCards.bahar.length}
          </Text>

        </View>


        <View style={styles.abCardsColumn}>

          {(
  abCards.bahar.length > 0
    ? abCards.bahar
    : result?.result?.bahar_cards?.length
      ? result.result.bahar_cards
      : result?.result?.bahar_card
        ? [result.result.bahar_card]
        : []
).map((card: any, index: number) => (
  <Animated.View
    key={`bahar-card-${index}`}
    entering={FadeInDown.delay(index * 80).duration(250)}
    style={[
      styles.abSmallCard,
      card?.rank === result?.result?.joker_card?.rank &&
        styles.abMatchCard,
    ]}
  >
    <View style={styles.abCardFace}>

      <Text
        style={[
          styles.abCardRank,
          {
            color:
              card?.suit === '♥️' ||
              card?.suit === '♦️'
                ? '#E53935'
                : '#111827',
          },
        ]}
      >
        {card?.rank}
      </Text>

      <Text
        style={[
          styles.abCardSuit,
          {
            color:
              card?.suit === '♥️' ||
              card?.suit === '♦️'
                ? '#E53935'
                : '#111827',
          },
        ]}
      >
        {card?.suit}
      </Text>

    </View>
  </Animated.View>
))}

          {/* Empty state */}
          {!busy && abCards.bahar.length === 0 && (
            <Text
              style={{
                color: '#999',
                fontSize: 12,
                marginTop: 10,
              }}
            >
              No cards
            </Text>
          )}

        </View>

      </View>

    </View>


    {/* RESULT */}
    {!busy && result?.result?.winner && (
      <Animated.View
        entering={ZoomIn.duration(300)}
        style={{
          marginTop: 14,
          alignSelf: 'center',
          paddingHorizontal: 22,
          paddingVertical: 10,
          borderRadius: 20,
          backgroundColor:
            result.result.winner === 'andar'
              ? '#FFF3E0'
              : '#E8F5E9',
        }}
      >

        <Text
          style={{
            fontSize: 16,
            fontWeight: '900',
            color:
              result.result.winner === 'andar'
                ? '#E65100'
                : '#2E7D32',
          }}
        >
          {String(result.result.winner).toUpperCase()} WINS
        </Text>

      </Animated.View>
    )}

  </View>
)}

                {gt === 'number-king' && (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.bigNumber} testID="number-roll">{busy ? liveMult : (result?.result?.roll ?? '?')}</Text>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Your pick: {numberPick}</Text>
                  </View>
                )}

{gt === 'plinko' && (
  <View style={styles.plinkoBoard}>

    {/* Header */}
    <View style={styles.plinkoHeader}>
      <View>
        <Text style={styles.plinkoTitle}>PLINKO</Text>
        <Text style={styles.plinkoSubtitle}>
          Drop the ball
        </Text>
      </View>

      <View style={styles.plinkoReady}>
        <View style={styles.plinkoReadyDot} />
        <Text style={styles.plinkoReadyText}>
          {busy ? 'PLAYING' : 'READY'}
        </Text>
      </View>
    </View>

    {/* Drop point */}
    <View style={styles.plinkoDropPoint}>
      <View style={styles.plinkoDropGlow} />
      <View style={styles.plinkoDropArrow}>
        <Ionicons
          name="arrow-down"
          size={18}
          color="#FFD700"
        />
      </View>
    </View>

    {/* Actual peg board */}
    <View style={styles.plinkoPegArea}>

      {Array.from({ length: 9 }).map((_, row) => {
        const pegCount = row + 1;

        return (
          <View
            key={`plinko-row-${row}`}
            style={[
              styles.plinkoPegRow,
              {
                width: Math.min(
                  310,
                  30 + pegCount * 31
                ),
              },
            ]}
          >
            {Array.from({ length: pegCount }).map(
              (_, col) => (
                <View
                  key={`plinko-peg-${row}-${col}`}
                  style={styles.plinkoPeg}
                />
              )
            )}
          </View>
        );
      })}

      {/* Falling ball */}
      <Animated.View
        style={[
          styles.plinkoBall,
          ballStyle,
        ]}
      >
        <View style={styles.plinkoBallHighlight} />
      </Animated.View>

    </View>

    {/* Bottom slots */}
    {/* Result rows */}
<View style={styles.plinkoResultRows}>

  {/* MULTIPLIER ROW */}
  <View style={styles.plinkoSlots}>
    {[10, 4, 2, 1.2, 0.5, 1.2, 2, 4, 10].map(
      (m, i) => {

        const selected =
          result?.result?.slot === i &&
          !busy;

        return (
          <View
            key={`plinko-slot-${i}`}
            style={[
              styles.plinkoSlotNew,
              selected &&
                styles.plinkoSlotWinner,
            ]}
          >
            <Text
              style={[
                styles.plinkoSlotText,
                selected &&
                  styles.plinkoSlotWinnerText,
              ]}
            >
              {m}x
            </Text>
          </View>
        );
      }
    )}
  </View>

  {/* LOSE ROW */}
  <View style={styles.plinkoLoseSlots}>
  {[4, 3, 2, 1.5, 1, 1.5, 2, 3, 4].map(
    (m, i) => {

      const selected =
        result?.result?.slot === i &&
        !busy;

      return (
        <View
          key={`plinko-second-slot-${i}`}
          style={[
            styles.plinkoLoseSlot,
            selected &&
              styles.plinkoLoseSlotActive,
          ]}
        >
          <Text
            style={[
              styles.plinkoLoseText,
              selected &&
                styles.plinkoLoseTextActive,
            ]}
          >
            {m}x
          </Text>
        </View>
      );
    }
  )}
</View>

 {/* FINAL RESULT */}
  {!busy && result?.result?.slot !== undefined && (
    <View style={styles.plinkoFinalResult}>
      <Text style={styles.plinkoFinalResultLabel}>
        FINAL
      </Text>

      <Text style={styles.plinkoFinalResultValue}>
        {Math.max(
          0,
          (
            [10, 4, 2, 1.2, 0.5, 1.2, 2, 4, 10][
              Number(result.result.slot)
            ] -
            [4, 3, 2, 1.5, 1, 1.5, 2, 3, 4][
              Number(result.result.slot)
            ]
          ).toFixed(2)
        )}x
      </Text>
    </View>
  )}



</View>
</View>
)}

                {gt === 'mines' && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(result?.result?.revealed || Array(minePicks).fill('?')).map((v: string, i: number) => {
                      const shown = !busy || i < revealCount;
                      return (
                        <Animated.View key={i} entering={FadeIn} style={[styles.mineTile, shown && v === 'gem' && { backgroundColor: '#2ECA7F' }, shown && v === 'mine' && { backgroundColor: '#FF4D4F' }]}>
                          <Ionicons name={!shown ? 'help' : v === 'gem' ? 'diamond' : v === 'mine' ? 'flame' : 'help'} size={24} color="#fff" />
                        </Animated.View>
                      );
                    })}
                  </View>
                )}

                {gt === 'match3' && (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {(result && !busy ? result.result.board : ['?', '?', '?']).map((sVal: string, i: number) => (
                      <Animated.View key={`${sVal}-${i}-${celebrate}`} entering={FadeInDown} style={styles.slot}><Text style={styles.slotText}>{busy ? '?' : sVal}</Text></Animated.View>
                    ))}
                  </View>
                )}

                {gt === 'bullseye' && (
                  <View style={{ alignItems: 'center', justifyContent: 'center', width: 130, height: 130 }}>
                    {[120, 90, 60, 32].map((sz, i) => (
                      <View key={i} style={{ width: sz, height: sz, borderRadius: sz / 2, position: 'absolute', backgroundColor: ['#fff', '#5B8CFF', '#FFB020', '#FF4D4F'][i], alignItems: 'center', justifyContent: 'center' }} />
                    ))}
                    <Animated.View style={[{ position: 'absolute' }, dartStyle]}><Ionicons name="locate" size={28} color="#111" /></Animated.View>
                  </View>
                )}

                {gt === 'sudoku' && (
                  <View style={{ alignItems: 'center' }}>
                    <Ionicons name="grid" size={80} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '800', marginTop: 8 }}>{busy ? 'Solving…' : 'Complete the grid'}</Text>
                  </View>
                )}

                {gt === 'tournament' && (
                  <View style={{ alignItems: 'center' }}>
                    <Ionicons name="trophy" size={72} color="#FFD700" />
                    <Text style={{ color: '#fff', fontWeight: '800', marginTop: 4, fontSize: 22 }}>#{result?.result?.rank ?? '?'}</Text>
                  </View>
                )}

                <Text style={styles.display} testID="game-display">{display}</Text>
                <View style={styles.statusBadge}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusText}>{busy || flying ? 'LIVE' : 'READY'}</Text>
                </View>
              </>
            )}

            <Particles show={celebrate} color={meta.color} />
          </LinearGradient>
        </View>

        {/* Round history */}
        {history.length > 0 && (
          <View style={styles.historyCard}>
            <Text style={styles.historyLabel}>Recent Results</Text>
            <View style={styles.historyRow}>
              {history.map((h, i) => (
                <Animated.View key={`${i}-${h.label}`} entering={FadeInDown.duration(250)} style={[styles.histChip, { backgroundColor: h.win ? '#2ECA7F' : '#5B8CFF' }]}>
                  <Text style={styles.histText} numberOfLines={1}>{h.win ? 'W' : 'L'}</Text>
                </Animated.View>
              ))}
            </View>
          </View>
        )}

        {result && !busy && (
          <Animated.View style={[styles.resultBox, resultStyle, { backgroundColor: result.win ? '#E7F8EE' : '#FDECEC' }]} testID="game-result">
            <Ionicons name={result.win ? 'trophy' : 'sad-outline'} size={22} color={result.win ? '#2ECA7F' : '#FF4D4F'} />
            <Text style={[styles.resultText, { color: result.win ? '#2ECA7F' : '#FF4D4F' }]}>
              {result.win 
              ? `You won ₹${Number(result?.payout ?? 0).toFixed(2)}` 
              : 'Better luck next time!'}
            </Text>
          </Animated.View>
        )}

        {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={18} color="#FF4D4F" /><Text style={styles.errorText}>{error}</Text></View>}

        {/* Controls */}
        <View style={styles.controls}>
          <Text style={styles.label}>Bet Amount (₹)</Text>
          <TextInput testID="game-bet" style={inputStyle.base} value={bet} onChangeText={setBet} keyboardType="number-pad" editable={!busy} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
            {[10, 50, 100, 500, 1000].map((v, i) => {
              const chipColors = ['#2ECA7F', '#5B8CFF', '#8B5CF6', '#FFB020', '#FF4D4F'];
              const isSelected = bet === String(v);
              return (
                <Pressable key={v} disabled={busy} onPress={() => setBet(String(v))} style={[styles.chip, { backgroundColor: chipColors[i] }, isSelected && { borderColor: '#FFD700', borderStyle: 'solid' }]} testID={`bet-${v}`}>
                  <Text style={styles.chipText}>{v >= 1000 ? `${v / 1000}K` : v}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {(gt === 'crash' || gt === 'aviator') && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Auto Cash-Out (×)</Text>
              <TextInput testID="cash-out" style={inputStyle.base} value={cashOut} onChangeText={setCashOut} keyboardType="decimal-pad" editable={!busy} />
            </View>
          )}

          {gt === 'dice' && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Prediction</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable testID="pick-under" disabled={busy} onPress={() => setPick('under')} style={[styles.pickBtn, pick === 'under' && styles.pickActive]}><Text style={[styles.pickText, pick === 'under' && { color: '#fff' }]}>Under {threshold}</Text></Pressable>
                <Pressable testID="pick-over" disabled={busy} onPress={() => setPick('over')} style={[styles.pickBtn, pick === 'over' && styles.pickActive]}><Text style={[styles.pickText, pick === 'over' && { color: '#fff' }]}>Over {threshold}</Text></Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                {[25, 50, 75].map(t => <Pressable key={t} disabled={busy} onPress={() => setThreshold(t)} style={[styles.chip, threshold === t && { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary }]} testID={`th-${t}`}><Text style={styles.chipText}>{t}</Text></Pressable>)}
              </View>
            </View>
          )}

          {gt === 'andar-bahar' && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Pick a Side</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['andar', 'bahar'] as const).map(k => (
                  <Pressable key={k} testID={`ab-${k}`} disabled={busy} onPress={() => setAbPick(k)} style={[styles.pickBtn, abPick === k && styles.pickActive]}><Text style={[styles.pickText, abPick === k && { color: '#fff' }]}>{k.toUpperCase()}</Text></Pressable>
                ))}
              </View>
            </View>
          )}

          {gt === 'number-king' && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Pick a Number (0-9) · Payout 3x</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Array.from({ length: 10 }).map((_, n) => (
                  <Pressable key={n} testID={`num-${n}`} disabled={busy} onPress={() => setNumberPick(n)} style={[styles.numBtn, numberPick === n && styles.numBtnA]}>
                    <Text style={[styles.numTxt, numberPick === n && { color: '#fff' }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {gt === 'mines' && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Tiles to reveal (higher = bigger reward)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Pressable key={n} testID={`picks-${n}`} disabled={busy} onPress={() => setMinePicks(n)} style={[styles.numBtn, minePicks === n && styles.numBtnA]}>
                    <Text style={[styles.numTxt, minePicks === n && { color: '#fff' }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={{ height: 16 }} />
          {isCrash && flying && myLiveBetPlaced ? (
            <Pressable testID="cash-out-btn" onPress={() => {
                if (!liveRoundId) return;
                api.liveCashout(liveRoundId).then((res: any) => {
                  setBalance(res.balance);
    
                  setMyLiveBetPlaced(false);
                  setResult({ win: res.win, payout: res.payout || 0, result: {} });
                  finishRound({ win: res.win }, res.win ? `CASHED @ ${res.multiplier}x` : `CRASHED @ ${(res.crash_point || 0).toFixed(2)}x`);
                }).catch((e: any) => setError(e.message || 'Cashout failed'));
              }} style={styles.cashOutBtn}>
              <Ionicons name="hand-left" size={20} color="#fff" />
              <Text style={styles.cashOutText}>CASH OUT · {liveMult}x</Text>
              <Text style={styles.cashOutSub}>₹{((parseFloat(bet) || 0) * parseFloat(liveMult)).toFixed(0)}</Text>
            </Pressable>
          ) : (
            <PrimaryButton testID="play-btn" label={busy ? (isCrash ? 'Launching…' : 'Playing…') : `Place Bet · ₹${bet || 0}`} onPress={play} loading={busy && !isCrash} disabled={busy} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function labelFor(gt: string, res: any): string {
  const r = res.result || {};
  switch (gt) {
    case 'crash': return res.win ? `CASHED @ ${r.cash_out}x` : `CRASHED @ ${(r.crash_at || 0).toFixed(2)}x`;
    case 'aviator': return res.win ? `CASHED @ ${r.cash_out}x` : `FLEW @ ${(r.fly_to || 0).toFixed(2)}x`;
    case 'dice': return `ROLLED ${r.roll}`;
    case 'andar-bahar': return `WINNER: ${(r.winner || '').toUpperCase()}`;
    case 'teenpatti': return res.win ? `WIN · ${r.player_hand}` : `${r.player_hand}`;
    case 'number-king': return `ROLLED ${r.roll}`;
    case 'plinko': return `x${r.multiplier}`;
    case 'mines': return res.win ? `SAFE x${r.multiplier}` : 'BOOM!';
    case 'match3': return (r.board || []).join(' ');
    case 'bullseye': return (r.ring || 'MISS').toUpperCase();
    case 'sudoku': return res.win ? 'SOLVED!' : 'TIME OUT';
    case 'tournament': return `RANK #${r.rank}`;
    default: return res.win ? 'WIN' : 'LOSE';
  }
}

function ComingSoon({ router }: any) {
  const { title } = useLocalSearchParams<{ title: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <LinearGradient colors={['#FFB99D', '#FF6B6B']}>
        <SafeAreaView edges={['top']} style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{title || 'Coming Soon'}</Text>
          <View style={{ width: 22 }} />
        </SafeAreaView>
      </LinearGradient>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="rocket-outline" size={80} color="#FF6B6B" />
        <Text style={{ marginTop: 16, fontSize: 20, fontWeight: '800', color: colors.onSurface }}>Launching Soon</Text>
        <Text style={{ marginTop: 8, color: colors.onSurfaceMuted }}>This game is coming very soon.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  stage: { borderRadius: radius.lg, marginBottom: spacing.md, borderWidth: 2, borderColor: '#FFD700', ...shadows.strong },
  stageBg: { minHeight: 260, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  display: { position: 'absolute', top: 16, right: 16, color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.5 },
  statusBadge: { position: 'absolute', top: 16, left: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2ECA7F' },
  statusText: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  countdown: { color: '#fff', fontSize: 90, fontWeight: '800' },
  liveMult: { position: 'absolute', color: '#FFD700', fontSize: 34, fontWeight: '800' },
  bigNumber: { color: '#FFD700', fontSize: 90, fontWeight: '800' },
  pointer: { position: 'absolute', top: 5, zIndex: 2, width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 16, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff' },
  wheel: { width: 172, height: 172, borderRadius: 86, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff' },
  wheelShadow: { borderRadius: 86, ...shadows.strong },
  wheelSeg: { position: 'absolute', width: 172, height: 86, top: 0, transformOrigin: '50% 100%', alignItems: 'center', paddingTop: 8 },
  wheelText: { color: '#fff', fontWeight: '800' },
  diceBox: { alignItems: 'center' },
  diceShadow: { ...shadows.strong },
  rollText: { color: '#fff', fontSize: 40, fontWeight: '800', marginTop: 8 },
  cardBox: { width: 62, height: 88, borderRadius: 10, backgroundColor: '#8B0000', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFD700', ...shadows.soft },
  cardInner: { width: '85%', height: '85%', borderWidth: 1, borderColor: '#FFD700', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  cardBorder: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cardWin: { borderWidth: 3, borderColor: '#FFD700', ...shadows.strong },
  cardFace: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dealerBox: { alignItems: 'center', marginBottom: 16, backgroundColor: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 12, borderWidth: 2, borderColor: '#FFD700' },
  dealerLabel: { color: '#FFD700', fontWeight: '800', fontSize: 12, marginBottom: 6, letterSpacing: 1 },
  cardRank: { fontSize: 22, fontWeight: '900' },
  cardSuit: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  gameSpaceBackground: {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  zIndex: 0,
},
crashAviatorStage: {
  minHeight: 428,
},
  
  tpTable: {
  width: '100%',
  minHeight: 420,
  borderRadius: 20,
  backgroundColor: '#07552F',
  borderWidth: 2,
  borderColor: '#D4AF37',
  paddingHorizontal: 12,
  paddingVertical: 14,
  alignItems: 'center',
  overflow: 'hidden',
},

tpHeader: {
  width: '100%',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
},

tpTitle: {
  color: '#FFD700',
  fontSize: 18,
  fontWeight: '900',
  letterSpacing: 1.5,
},

tpSubtitle: {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 8,
  fontWeight: '800',
  letterSpacing: 1,
  marginTop: 2,
},

tpLiveBadge: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderRadius: 12,
  backgroundColor: 'rgba(0,0,0,0.2)',
},

tpLiveDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: '#36E58A',
  marginRight: 5,
},

tpLiveText: {
  color: '#36E58A',
  fontSize: 8,
  fontWeight: '900',
},

tpSectionTitle: {
  color: 'rgba(255,255,255,0.72)',
  fontSize: 9,
  fontWeight: '900',
  letterSpacing: 1,
  marginBottom: 6,
},

tpCardsRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
},

tpCard: {
  width: 62,
  height: 86,
  borderRadius: 9,
  backgroundColor: '#fff',
  borderWidth: 2,
  borderColor: '#D4AF37',
  overflow: 'hidden',
  elevation: 7,
},

tpCardFace: {
  width: '100%',
  height: '100%',
  backgroundColor: '#fff',
  alignItems: 'center',
  justifyContent: 'center',
},

tpCardBack: {
  width: '100%',
  height: '100%',
  borderRadius: 7,
},

tpCardRank: {
  fontSize: 25,
  fontWeight: '900',
},

tpCardSuit: {
  fontSize: 23,
  fontWeight: '900',
  marginTop: -2,
},

tpHandBadge: {
  marginTop: 7,
  paddingHorizontal: 14,
  paddingVertical: 5,
  borderRadius: 14,
  backgroundColor: 'rgba(255,215,0,0.18)',
  borderWidth: 1,
  borderColor: 'rgba(255,215,0,0.45)',
},

tpHandText: {
  color: '#FFD700',
  fontSize: 9,
  fontWeight: '900',
  letterSpacing: 0.8,
},

tpVsRow: {
  width: '92%',
  flexDirection: 'row',
  alignItems: 'center',
  marginVertical: 10,
},

tpVsLine: {
  flex: 1,
  height: 1,
  backgroundColor: 'rgba(212,175,55,0.45)',
},

tpVs: {
  width: 40,
  height: 40,
  borderRadius: 20,
  marginHorizontal: 10,
  backgroundColor: '#D4AF37',
  alignItems: 'center',
  justifyContent: 'center',
},

tpVsText: {
  color: '#111827',
  fontSize: 11,
  fontWeight: '900',
},

abTable: {
  width: '100%',
  minHeight: 420,
  borderRadius: 20,
  backgroundColor: '#063E25',
  borderWidth: 2,
  borderColor: '#D4AF37',
  paddingHorizontal: 10,
  paddingVertical: 14,
  
},

abHeader: {
  width: '100%',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
},

abTitle: {
  color: '#FFD700',
  fontSize: 17,
  fontWeight: '900',
  letterSpacing: 1.2,
},

abSubtitle: {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 8,
  fontWeight: '800',
  letterSpacing: 1,
  marginTop: 2,
},

abLiveBadge: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderRadius: 12,
  backgroundColor: 'rgba(0,0,0,0.22)',
},

abLiveDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: '#36E58A',
  marginRight: 5,
},

abLiveText: {
  color: '#36E58A',
  fontSize: 8,
  fontWeight: '900',
},

abJokerSection: {
  alignItems: 'center',
  marginBottom: 12,
},

abJokerLabel: {
  color: '#FFD700',
  fontSize: 10,
  fontWeight: '900',
  letterSpacing: 1,
  marginBottom: 6,
},

abJokerCard: {
  width: 68,
  height: 92,
  borderRadius: 9,
  backgroundColor: '#fff',
  borderWidth: 2,
  borderColor: '#FFD700',
  overflow: 'hidden',
  elevation: 8,
},

abJokerImage: {
  width: '100%',
  height: '100%',
  resizeMode: 'contain',
},

abJokerRank: {
  fontSize: 28,
  fontWeight: '900',
},

abJokerSuit: {
  fontSize: 24,
  fontWeight: '900',
},

abTargetText: {
  color: 'rgba(255,255,255,0.5)',
  fontSize: 7,
  fontWeight: '900',
  marginTop: 6,
},

abSides: {
  width: '100%',
  flexDirection: 'row',
  justifyContent: 'space-between',
},

abSide: {
  width: '48%',
  minHeight: 200,
  borderRadius: 13,
  backgroundColor: 'rgba(0,0,0,0.15)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.1)',
  padding: 7,
},

abSideHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 7,
},

abSideTitle: {
  color: '#fff',
  fontSize: 11,
  fontWeight: '900',
  letterSpacing: 1,
},

abCount: {
  minWidth: 20,
  height: 20,
  borderRadius: 10,
  backgroundColor: '#D4AF37',
  color: '#111827',
  fontSize: 8,
  fontWeight: '900',
  textAlign: 'center',
  paddingTop: 5,
},

abCardsColumn: {
  alignItems: 'center',
  gap: 4,
},

abSmallCard: {
  width: 48,
  height: 58,
  borderRadius: 6,
  backgroundColor: '#fff',
  borderWidth: 1,
  borderColor: '#D4AF37',
  overflow: 'hidden',
  elevation: 4,
},

abCardFace: {
  width: '100%',
  height: '100%',
  backgroundColor: '#fff',
  alignItems: 'center',
  justifyContent: 'center',
},

abCardRank: {
  fontSize: 18,
  fontWeight: '900',
},

abCardSuit: {
  fontSize: 16,
  fontWeight: '900',
  marginTop: -2,
},

abBack: {
  width: '100%',
  height: '100%',
  backgroundColor: '#173766',
  alignItems: 'center',
  justifyContent: 'center',
},

abBackText: {
  color: '#FFD700',
  fontSize: 21,
  fontWeight: '900',
},

abMatchCard: {
  borderWidth: 3,
  borderColor: '#FFD700',
  elevation: 10,
},

abWinner: {
  alignSelf: 'center',
  marginTop: 12,
  paddingHorizontal: 20,
  paddingVertical: 8,
  borderRadius: 20,
  backgroundColor: '#FFD700',
  alignItems: 'center',
},

abWinnerText: {
  color: '#111827',
  fontSize: 14,
  fontWeight: '900',
  letterSpacing: 1,
},

abWinnerSub: {
  color: '#111827',
  fontSize: 8,
  fontWeight: '800',
  marginTop: 2,
},
  plinkoSlot: { width: 24, height: 26, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  plinkoBoard: {
  width: '100%',
  height: 400,
  borderRadius: 18,
  backgroundColor: '#07152F',
  borderWidth: 2,
  borderColor: '#315FA8',
  overflow: 'hidden',
  paddingTop: 0,
},

plinkoHeader: {
  width: '92%',
  alignSelf: 'center',
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},

plinkoTitle: {
  color: '#fff',
  fontSize: 18,
  fontWeight: '900',
  letterSpacing: 1,
},

plinkoSubtitle: {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 10,
  fontWeight: '600',
  marginTop: 2,
},

plinkoReady: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 2,
},

plinkoReadyDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: '#2ECA7F',
},

plinkoReadyText: {
  color: '#2ECA7F',
  fontSize: 11,
  fontWeight: '900',
},

plinkoDropPoint: {
  height: 20,
  alignItems: 'center',
  justifyContent: 'center',
},

plinkoDropGlow: {
  position: 'absolute',
  width: 28,
  height: 28,
  borderRadius: 14,
  backgroundColor: 'rgba(255,215,0,0.15)',
},

plinkoDropArrow: {
  width: 32,
  height: 26,
  borderRadius: 13,
  backgroundColor: 'rgba(255,215,0,0.12)',
  alignItems: 'center',
  justifyContent: 'center',
},

plinkoPegArea: {
  width: '100%',
  height: 173,
  alignItems: 'center',
  justifyContent: 'flex-start',
  position: 'relative',
},

plinkoPegRow: {
  height: 18,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},

plinkoPeg: {
  width: 9,
  height: 9,
  borderRadius: 4.5,
  backgroundColor: '#DDEAFF',
  borderWidth: 1,
  borderColor: '#FFFFFF',
  shadowColor: '#5B8CFF',
  shadowOpacity: 0.75,
  shadowRadius: 5,
  elevation: 5,
},

plinkoBall: {
  position: 'absolute',
  top: 3,
  left: '50%',
  marginLeft: -11,
  width: 22,
  height: 22,
  borderRadius: 11,
  backgroundColor: '#FFD000',
  borderWidth: 2,
  borderColor: '#FFF2A0',
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#FFD000',
  shadowOpacity: 1,
  shadowRadius: 10,
  elevation: 10,
},

plinkoBallHighlight: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: '#FFF9C4',
},

plinkoSlots: {
  width: '94%',
  height: 43,
  alignSelf: 'center',
  flexDirection: 'row',
  gap: 3,
  alignItems: 'center',
},

plinkoSlotNew: {
  flex: 1,
  height: 38,
  borderRadius: 7,
  backgroundColor: '#182A50',
  borderWidth: 1,
  borderColor: '#31558E',
  alignItems: 'center',
  justifyContent: 'center',
},

plinkoSlotWinner: {
  backgroundColor: '#FFD000',
  borderColor: '#FFF2A0',
  transform: [
    { scale: 1.08 },
  ],
  shadowColor: '#FFD000',
  shadowOpacity: 0.9,
  shadowRadius: 8,
  elevation: 8,
},

plinkoSlotText: {
  color: '#FFFFFF',
  fontSize: 9,
  fontWeight: '900',
},

plinkoSlotWinnerText: {
  color: '#111827',
  fontSize: 10,
  fontWeight: '900',
},

plinkoResultRows: {
  width: '94%',
  alignSelf: 'center',
},

plinkoLoseSlots: {
  width: '100%',
  height: 43,
  flexDirection: 'row',
  gap: 3,
  alignItems: 'center',
  marginTop: 3,
},

plinkoLoseSlot: {
  flex: 1,
  height: 38,
  borderRadius: 7,
  backgroundColor: '#3A1720',
  borderWidth: 1,
  borderColor: '#71313F',
  alignItems: 'center',
  justifyContent: 'center',
},

plinkoLoseSlotActive: {
  backgroundColor: '#FF4D5F',
  borderColor: '#FF9AA5',
  transform: [
    { scale: 1.08 },
  ],
  shadowColor: '#FF4D5F',
  shadowOpacity: 0.9,
  shadowRadius: 8,
  elevation: 8,
},

plinkoLoseText: {
  color: '#FFB8C0',
  fontSize: 8,
  fontWeight: '900',
  letterSpacing: 0.4,
},

plinkoLoseTextActive: {
  color: '#FFFFFF',
  fontSize: 9,
  fontWeight: '900',
},
plinkoFinalResult: {
  marginTop: 5,
  alignSelf: 'center',
  minWidth: 80,
  height: 30,
  paddingHorizontal: 12,
  borderRadius: 8,
  backgroundColor: '#FFD000',
  borderWidth: 1,
  borderColor: '#FFF2A0',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: 6,
},

plinkoFinalResultLabel: {
  color: '#111827',
  fontSize: 8,
  fontWeight: '900',
},

plinkoFinalResultValue: {
  color: '#111827',
  fontSize: 13,
  fontWeight: '900',
},

  plinkoText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  mineTile: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  slot: { width: 60, height: 72, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  slotText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  ring: {},
  historyCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, ...shadows.card },
  historyLabel: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary, marginBottom: 10 },
  historyRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  histChip: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', ...shadows.soft },
  histText: { fontWeight: '800', fontSize: 13, color: '#fff' },
  resultBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg, marginBottom: spacing.md },
  resultText: { fontSize: 15, fontWeight: '800' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FDECEC', padding: 12, borderRadius: radius.md, marginBottom: spacing.md },
  errorText: { color: '#FF4D4F', fontWeight: '700', flex: 1 },
  controls: { backgroundColor: '#fff', borderRadius: radius.lg, padding: spacing.lg, ...shadows.card },
  label: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary, marginBottom: 8 },
  chip: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', borderStyle: 'dashed', ...shadows.strong },
  chipText: { fontWeight: '800', color: '#fff', fontSize: 12 },
  chipText: { fontWeight: '800', color: colors.onSurface },
  pickBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  pickActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pickText: { fontWeight: '800', color: colors.onSurface },
  numBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  numBtnA: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  numTxt: { fontWeight: '800', color: colors.onSurface },
  cashOutBtn: { minHeight: 56, borderRadius: radius.pill, backgroundColor: '#2ECA7F', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...shadows.card },
  cashOutText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  cashOutSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '800' },

  dtTable: {
  width: '100%',
  borderRadius: 20,
  backgroundColor: '#082B20',
  borderWidth: 2,
  borderColor: '#D4AF37',
  padding: 12,
  marginBottom: 12,
},

dtHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 15,
},

dtTitle: {
  color: '#FFD700',
  fontSize: 18,
  fontWeight: '900',
},

dtSubtitle: {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 8,
  fontWeight: '800',
  marginTop: 3,
},

dtTimerBox: {
  minWidth: 68,
  paddingVertical: 6,
  paddingHorizontal: 9,
  borderRadius: 10,
  backgroundColor: 'rgba(0,0,0,0.3)',
  alignItems: 'center',
},

dtTimerLabel: {
  color: '#AFA58E',
  fontSize: 8,
  fontWeight: '800',
},

dtTimer: {
  color: '#FFD700',
  fontSize: 18,
  fontWeight: '900',
},

dtCardsRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},

dtSide: {
  width: '42%',
  alignItems: 'center',
},

dtWinnerSide: {
  transform: [
    { scale: 1.04 },
  ],
},

dtSideTitle: {
  color: '#FFF',
  fontSize: 13,
  fontWeight: '900',
  marginBottom: 8,
},

dtCard: {
  width: 88,
  height: 120,
  borderRadius: 12,
  backgroundColor: '#FFF',
  borderWidth: 2,
  borderColor: '#D4AF37',
  alignItems: 'center',
  justifyContent: 'center',
},

dtRank: {
  fontSize: 31,
  fontWeight: '900',
},

dtSuit: {
  fontSize: 36,
  fontWeight: '900',
},

dtQuestion: {
  color: '#D4AF37',
  fontSize: 45,
  fontWeight: '900',
},

dtBetButton: {
  width: 94,
  marginTop: 8,
  paddingVertical: 9,
  borderRadius: 9,
  alignItems: 'center',
},

dtDragonButton: {
  backgroundColor: '#9B2525',
},

dtTigerButton: {
  backgroundColor: '#A66A18',
},

dtSelectedButton: {
  borderWidth: 2,
  borderColor: '#FFF',
},

dtBetText: {
  color: '#FFF',
  fontSize: 9,
  fontWeight: '900',
},

dtVs: {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: '#D4AF37',
  alignItems: 'center',
  justifyContent: 'center',
  marginHorizontal: 4,
},

dtVsText: {
  color: '#111',
  fontSize: 10,
  fontWeight: '900',
},

dtResultBox: {
  marginTop: 12,
  paddingVertical: 10,
  borderRadius: 10,
  backgroundColor: 'rgba(0,0,0,0.25)',
  alignItems: 'center',
},

dtResult: {
  color: '#FFD700',
  fontSize: 18,
  fontWeight: '900',
},

dtWin: {
  color: '#5CFF9A',
  fontSize: 11,
  fontWeight: '900',
  marginTop: 3,
},

dtLose: {
  color: '#FF7373',
  fontSize: 11,
  fontWeight: '900',
  marginTop: 3,
},

dtStats: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginTop: 12,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: 'rgba(212,175,55,0.25)',
},

dtStat: {
  color: 'rgba(255,255,255,0.65)',
  fontSize: 8,
  fontWeight: '800',
},
dtCharacterBox: {
  width: 115,
  height: 125,
  alignItems: 'center',
  justifyContent: 'center',
},

dtDragonImage: {
  width: 115,
  height: 125,
},

dtTigerImage: {
  width: 115,
  height: 125,
},

dtWinnerCharacter: {
  zIndex: 10,
},
});
