import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'villan.token';
type Match = { id: string; name?: string; format?: string; status?: string; live?: boolean; starting_at?: string; venue?: string; team_a?: { name?: string; code?: string }; team_b?: { name?: string; code?: string }; scores?: any[]; note?: string };
type Player = { id: string; name: string; role: string; team_id?: string | number; credits: number; photo?: string };
type Contest = { id: string; name: string; entry_fee: number; prizes: number[]; max_entries: number; joined_count?: number; joined?: boolean; status?: string };
type FantasyTeam = { id: string; match_id: string; team_name: string; player_ids: string[]; captain_id: string; vice_captain_id: string; credits_used?: number };
type LeaderboardRow = { rank: number; team_id: string; team_name: string; points: number; players?: { player_id: string; name: string; base_points: number; multiplier: number; points: number }[] };
type MatchPoints = { match_status?: string; finished?: boolean; updated_at?: string; players?: { player_id: string; name: string; points: number }[] };

function apiPath(path: string) {
  const root = BASE.endsWith('/api') ? BASE : `${BASE}/api`;
  return `${root}${path}`;
}

export default function FantasyCricketScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'matches' | 'players' | 'contests' | 'teams'>('matches');
  const [status, setStatus] = useState<'all' | 'live' | 'upcoming' | 'completed'>('all');
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [captainId, setCaptainId] = useState('');
  const [viceCaptainId, setViceCaptainId] = useState('');
  const [teamName, setTeamName] = useState('My Fantasy Team');
  const [contests, setContests] = useState<Contest[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [matchPoints, setMatchPoints] = useState<MatchPoints | null>(null);
  const [leaderboards, setLeaderboards] = useState<Record<string, { leaderboard: LeaderboardRow[]; settled?: boolean; match_status?: string; updated_at?: string }>>({});
  const [leaderboardLoading, setLeaderboardLoading] = useState<Record<string, boolean>>({});

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const response = await fetch(apiPath(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw || 'Unexpected server response' }; }
    if (!response.ok) throw new Error(data?.detail || data?.message || `Request failed (${response.status})`);
    return data;
  }, []);

  const loadWallet = useCallback(async () => {
    try { const data = await request('/fantasy/wallet'); setBalance(Number(data.balance || 0)); }
    catch (e: any) { setError(e.message || 'Wallet load nahi hua'); }
  }, [request]);

  const loadMatches = useCallback(async (nextStatus = status, isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await request(`/fantasy/matches?status=${nextStatus}&days=7`);
      setMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch (e: any) { setError(e.message || 'Matches load nahi hue'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [request, status]);

  useEffect(() => { loadMatches('all'); loadWallet(); }, [loadMatches, loadWallet]);

  const loadTeams = useCallback(async (matchId?: string) => {
    try {
      const data = await request(`/fantasy/teams${matchId ? `?match_id=${encodeURIComponent(matchId)}` : ''}`);
      setTeams(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e.message || 'Teams load nahi hui'); }
  }, [request]);

  const loadMatchPoints = useCallback(async (matchId: string) => {
    try {
      const data = await request(`/fantasy/matches/${encodeURIComponent(matchId)}/points`);
      setMatchPoints(data);
    } catch (e: any) {
      // Live points may be temporarily unavailable before the provider publishes scorecards.
      console.warn('Fantasy points refresh failed:', e.message || e);
    }
  }, [request]);

  const loadLeaderboard = async (contestId: string) => {
    setLeaderboardLoading(prev => ({ ...prev, [contestId]: true }));
    try {
      const data = await request(`/fantasy/contests/${encodeURIComponent(contestId)}/leaderboard`);
      setLeaderboards(prev => ({ ...prev, [contestId]: data }));
      await loadWallet();
    } catch (e: any) {
      setError(e.message || 'Leaderboard load nahi hua');
    } finally {
      setLeaderboardLoading(prev => ({ ...prev, [contestId]: false }));
    }
  };

  useEffect(() => {
    const matchId = selectedMatch?.id;
    if (!matchId || (tab !== 'players' && tab !== 'contests')) return;
    loadMatchPoints(matchId);
    const timer = setInterval(() => loadMatchPoints(matchId), 30000);
    return () => clearInterval(timer);
  }, [selectedMatch?.id, tab, loadMatchPoints]);

  const visibleLeaderboardIds = Object.keys(leaderboards).join(',');
  useEffect(() => {
    if (tab !== 'contests' || !visibleLeaderboardIds) return;
    const ids = visibleLeaderboardIds.split(',').filter(Boolean);
    const timer = setInterval(() => {
      ids.forEach(contestId => {
        request(`/fantasy/contests/${encodeURIComponent(contestId)}/leaderboard`)
          .then(data => {
            setLeaderboards(prev => ({ ...prev, [contestId]: data }));
            if (data?.settled) loadWallet();
          })
          .catch(e => console.warn('Leaderboard refresh failed:', e?.message || e));
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [tab, selectedMatch?.id, visibleLeaderboardIds, request, loadWallet]);

  const chooseMatch = async (match: Match) => {
    setSelectedMatch(match); setMatchPoints(null); setLoading(true); setError(''); setSelectedIds([]); setCaptainId(''); setViceCaptainId('');
    try {
      const data = await request(`/fantasy/matches/${encodeURIComponent(match.id)}/players`);
      setPlayers(Array.isArray(data.players) ? data.players : []);
      if (!Array.isArray(data.players) || data.players.length < 11) {
        setError('Is match ki official lineup mein abhi 11 players available nahi hain. Lineup publish hone ke baad dobara try karein.');
      }
      setTab('players');
    } catch (e: any) { setError(e.message || 'Players load nahi hue'); }
    finally { setLoading(false); }
  };

  const pickedPlayers = useMemo(() => players.filter(p => selectedIds.includes(String(p.id))), [players, selectedIds]);
  const creditsUsed = useMemo(() => pickedPlayers.reduce((sum, p) => sum + Number(p.credits || 0), 0), [pickedPlayers]);

  const togglePlayer = (player: Player) => {
    const id = String(player.id);
    if (selectedIds.includes(id)) {
      setSelectedIds(prev => prev.filter(x => x !== id));
      if (captainId === id) setCaptainId('');
      if (viceCaptainId === id) setViceCaptainId('');
      return;
    }
    if (selectedIds.length >= 11) { Alert.alert('Team full', 'Team mein exactly 11 players select karne hain.'); return; }
    const sameTeamCount = pickedPlayers.filter(p => String(p.team_id || 'unknown') === String(player.team_id || 'unknown')).length;
    if (sameTeamCount >= 7) { Alert.alert('Selection limit', 'Ek real team se maximum 7 players select kar sakte ho.'); return; }
    if (creditsUsed + Number(player.credits || 0) > 100) { Alert.alert('Credit limit', 'Team ke total credits 100 se zyada nahi ho sakte.'); return; }
    setSelectedIds(prev => [...prev, id]);
  };

  const createTeam = async () => {
    if (!selectedMatch) return;
    if (selectedIds.length !== 11) { Alert.alert('11 players select karo', `Abhi ${selectedIds.length}/11 players selected hain.`); return; }
    if (!captainId || !viceCaptainId) { Alert.alert('Captain select karo', 'Captain aur Vice-Captain dono select karna zaroori hai.'); return; }
    if (captainId === viceCaptainId) { Alert.alert('Selection error', 'Captain aur Vice-Captain alag hone chahiye.'); return; }
    setSavingTeam(true); setError('');
    try {
      await request('/fantasy/teams', { method: 'POST', body: JSON.stringify({ match_id: selectedMatch.id, team_name: teamName.trim() || 'My Fantasy Team', player_ids: selectedIds, captain_id: captainId, vice_captain_id: viceCaptainId }) });
      Alert.alert('Team saved', 'Fantasy team successfully create ho gayi. Ab contest join kar sakte ho.');
      await loadTeams(selectedMatch.id);
      await loadContests(selectedMatch.id);
      setTab('contests');
    } catch (e: any) { setError(e.message || 'Team save nahi hui'); }
    finally { setSavingTeam(false); }
  };

  const loadContests = async (matchId: string) => {
    setLoading(true); setError('');
    try {
      const data = await request(`/fantasy/contests?match_id=${encodeURIComponent(matchId)}`);
      const contestList: Contest[] = Array.isArray(data) ? data : [];
      setContests(contestList);
      await loadTeams(matchId);

      // Fetch every leaderboard as soon as the Contests screen opens,
      // so users do not have to tap each Leaderboard button first.
      const leaderboardResults = await Promise.all(contestList.map(async contest => {
        try {
          const board = await request(`/fantasy/contests/${encodeURIComponent(contest.id)}/leaderboard`);
          return [contest.id, board] as const;
        } catch (e: any) {
          console.warn(`Leaderboard load failed for ${contest.id}:`, e?.message || e);
          return null;
        }
      }));
      setLeaderboards(prev => {
        const next = { ...prev };
        leaderboardResults.forEach(result => {
          if (result) next[result[0]] = result[1];
        });
        return next;
      });
      // Keep the displayed wallet in sync in case a completed contest settles.
      await loadWallet();
    } catch (e: any) { setError(e.message || 'Contests load nahi hue'); }
    finally { setLoading(false); }
  };

  const joinContest = async (contest: Contest) => {
    if (!selectedMatch) return;
    const matchingTeams = teams.filter(t => t.match_id === selectedMatch.id);
    if (!matchingTeams.length) { Alert.alert('Team required', 'Pehle is match ke liye apni 11-player team create karo.'); setTab('players'); return; }
    const team = matchingTeams[0];
    Alert.alert('Join contest?', `${contest.name}\nEntry: ${contest.entry_fee} coins\nPrize pool: ${contest.prizes?.join(' / ')} coins\n\nTeam: ${team.team_name}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Join', onPress: async () => {
        setLoading(true); setError('');
        try {
          const data = await request(`/fantasy/contests/${encodeURIComponent(contest.id)}/join`, { method: 'POST', body: JSON.stringify({ team_id: team.id }) });
          if (typeof data?.wallet?.balance === 'number') setBalance(data.wallet.balance); else await loadWallet();
          Alert.alert('Contest joined', 'Tumhara contest entry confirm ho gaya.');
          if (selectedMatch) await loadContests(selectedMatch.id);
        } catch (e: any) { setError(e.message || 'Contest join nahi hua'); }
        finally { setLoading(false); }
      } },
    ]);
  };

  const openContests = async (match: Match) => { setSelectedMatch(match); setMatchPoints(null); await loadContests(match.id); setTab('contests'); loadMatchPoints(match.id); };
  const openMyTeams = async () => { await loadTeams(); setTab('teams'); };

  const matchLabel = (m: Match) => `${m.team_a?.code || m.team_a?.name || 'Team A'} vs ${m.team_b?.code || m.team_b?.name || 'Team B'}`;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topbar}>
        <Pressable onPress={() => tab === 'matches' ? router.back() : setTab('matches')} style={styles.back}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.heading}>FANTASY CRICKET</Text><Text style={styles.subheading}>Build your XI · Play with your coins</Text></View>
        <View style={styles.wallet}><Ionicons name="wallet" size={15} color="#FDE68A"/><Text style={styles.walletText}>{balance === null ? '—' : balance.toLocaleString('en-IN')}</Text></View>
      </View>
      <View style={styles.tabs}>
        {([{ id: 'matches', label: 'Matches' }, { id: 'players', label: 'Create XI' }, { id: 'contests', label: 'Contests' }, { id: 'teams', label: 'My Teams' }] as const).map(item => (
          <Pressable key={item.id} onPress={() => item.id === 'teams' ? openMyTeams() : setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}><Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text></Pressable>
        ))}
      </View>
      {!!error && <Pressable onPress={() => setError('')} style={styles.errorBox}><Ionicons name="alert-circle" size={16} color="#FCA5A5"/><Text style={styles.errorText}>{error}</Text><Text style={styles.dismiss}>×</Text></Pressable>}
      {loading && <View style={styles.loading}><ActivityIndicator color="#34D399"/><Text style={styles.loadingText}>Loading...</Text></View>}

      {tab === 'matches' && <>
        <View style={styles.filterRow}>{(['all', 'live', 'upcoming', 'completed'] as const).map(s => <Pressable key={s} onPress={() => { setStatus(s); loadMatches(s); }} style={[styles.filter, status === s && styles.filterActive]}><Text style={[styles.filterText, status === s && styles.filterTextActive]}>{s.toUpperCase()}</Text></Pressable>)}</View>
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadMatches(status, true)} tintColor="#34D399" />}>
          {matches.length === 0 && !loading ? <View style={styles.empty}><Ionicons name="trophy" size={36} color="#64748B"/><Text style={styles.emptyTitle}>No matches found</Text><Text style={styles.emptySub}>Check your cricket API key/plan, then pull to refresh.</Text></View> : matches.map(m => (
            <View key={m.id} style={styles.matchCard}>
              <View style={styles.matchMeta}><Text style={styles.format}>{(m.format || 'CRICKET').toUpperCase()}</Text><Text style={[styles.status, m.live && styles.liveStatus]}>{m.live ? '● LIVE' : (m.status || 'UPCOMING').toUpperCase()}</Text></View>
              <Text style={styles.matchTitle}>{matchLabel(m)}</Text>
              <Text style={styles.matchSub}>{m.name || 'Cricket match'}{m.starting_at ? `  ·  ${new Date(m.starting_at).toLocaleString()}` : ''}</Text>
              {!!m.scores?.length && <Text style={styles.score}>{m.scores.map(s => `${s.score || '—'}${s.wickets != null ? `/${s.wickets}` : ''}${s.overs ? ` (${s.overs})` : ''}`).join('   ·   ')}</Text>}
              <View style={styles.buttonRow}><Pressable style={styles.primaryBtn} onPress={() => chooseMatch(m)}><Text style={styles.primaryText}>Create Team</Text></Pressable><Pressable style={styles.secondaryBtn} onPress={() => openContests(m)}><Text style={styles.secondaryText}>View Contests</Text></Pressable></View>
            </View>
          ))}
        </ScrollView>
      </>}

      {tab === 'players' && <ScrollView contentContainerStyle={styles.content}>
        {!selectedMatch ? <View style={styles.empty}><Text style={styles.emptyTitle}>Select a match first</Text><Pressable style={styles.primaryBtn} onPress={() => setTab('matches')}><Text style={styles.primaryText}>Browse matches</Text></Pressable></View> : <>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{matchLabel(selectedMatch)}</Text><Text style={styles.sectionSub}>{selectedIds.length}/11 players · {creditsUsed.toFixed(1)}/100 credits</Text></View>
          <TextInput value={teamName} onChangeText={setTeamName} placeholder="Team name" placeholderTextColor="#94A3B8" style={styles.input} maxLength={40}/>
          {players.map(p => {
            const id = String(p.id); const picked = selectedIds.includes(id);
            return <Pressable key={id} onPress={() => togglePlayer(p)} style={[styles.playerRow, picked && styles.playerPicked]}>
              <View style={styles.playerAvatar}><Text style={styles.playerInitial}>{(p.name || '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.playerName}>{p.name}</Text><Text style={styles.playerMeta}>{p.role} · {p.credits} credits · {Number(matchPoints?.players?.find(x => String(x.player_id) === id)?.points || 0).toFixed(1)} pts</Text></View>
              <Pressable onPress={() => { if (!picked) { Alert.alert('Select player first', 'Player ko team mein add karo, phir Captain/VC set karo.'); return; } setCaptainId(id); }} style={[styles.captainBtn, captainId === id && styles.captainSelected]}><Text style={[styles.captainText, captainId === id && styles.captainTextSelected]}>C</Text></Pressable>
              <Pressable onPress={() => { if (!picked) { Alert.alert('Select player first', 'Player ko team mein add karo, phir Captain/VC set karo.'); return; } setViceCaptainId(id); }} style={[styles.captainBtn, viceCaptainId === id && styles.viceSelected]}><Text style={[styles.captainText, viceCaptainId === id && styles.captainTextSelected]}>VC</Text></Pressable>
              <Ionicons name={picked ? 'checkmark-circle' : 'add-circle-outline'} size={23} color={picked ? '#34D399' : '#64748B'} />
            </Pressable>;
          })}
          <Text style={styles.helper}>Player row tap karke add/remove karein. Right side C = Captain (2× points), VC = Vice-Captain (1.5× points).</Text>
          <Pressable disabled={savingTeam} style={[styles.primaryBtn, styles.fullBtn, savingTeam && { opacity: 0.5 }]} onPress={createTeam}><Text style={styles.primaryText}>{savingTeam ? 'Saving team...' : 'Save Team & View Contests'}</Text></Pressable>
        </>}
      </ScrollView>}

      {tab === 'contests' && <ScrollView contentContainerStyle={styles.content}>
        {!selectedMatch ? <View style={styles.empty}><Text style={styles.emptyTitle}>Choose a match to see contests</Text><Pressable style={styles.primaryBtn} onPress={() => setTab('matches')}><Text style={styles.primaryText}>Browse matches</Text></Pressable></View> : <>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{matchLabel(selectedMatch)}</Text><Text style={styles.sectionSub}>Entry fees use your existing main wallet.</Text></View>
          <View style={styles.pointsCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointsTitle}>LIVE FANTASY POINTS</Text>
              <Text style={styles.pointsSub}>{matchPoints?.match_status ? `Match: ${String(matchPoints.match_status).toUpperCase()}` : 'Waiting for scorecard data'} · Auto refresh 30 sec</Text>
              {!!matchPoints?.updated_at && <Text style={styles.pointsSub}>Updated: {new Date(matchPoints.updated_at).toLocaleTimeString()}</Text>}
            </View>
            <Pressable style={styles.pointsRefresh} onPress={() => loadMatchPoints(selectedMatch.id)}><Ionicons name="refresh" size={17} color="#D1FAE5" /></Pressable>
          </View>
          {contests.map(c => <View key={c.id} style={styles.contestCard}>
            <View style={{ flex: 1 }}><Text style={styles.contestTitle}>{c.name}</Text><Text style={styles.contestSub}>{c.joined_count || 0}/{c.max_entries} entries · Prizes: {(c.prizes || []).join(' / ')} coins</Text><Text style={styles.contestSub}>{c.joined ? 'Already joined' : c.entry_fee === 0 ? 'Free entry' : `${c.entry_fee} coins entry`}</Text></View>
            <Pressable disabled={!!c.joined} onPress={() => joinContest(c)} style={[styles.joinBtn, !!c.joined && styles.joinDisabled]}><Text style={styles.joinText}>{c.joined ? 'Joined' : 'Join'}</Text></Pressable>
            <Pressable onPress={() => loadLeaderboard(c.id)} style={styles.leaderboardBtn}><Text style={styles.leaderboardBtnText}>{leaderboardLoading[c.id] ? '...' : 'Leaderboard'}</Text></Pressable>
            {!!leaderboards[c.id] && <View style={styles.leaderboardPanel}>
              <View style={styles.leaderboardHeader}><Text style={styles.leaderboardTitle}>LEADERBOARD</Text><Text style={styles.leaderboardState}>{leaderboards[c.id].settled ? 'SETTLED' : 'LIVE'}</Text></View>
              {(leaderboards[c.id].leaderboard || []).length === 0 ? <Text style={styles.pointsSub}>Abhi leaderboard entries nahi hain.</Text> : (leaderboards[c.id].leaderboard || []).slice(0, 10).map(row => (
                <View key={`${row.team_id}-${row.rank}`} style={styles.rankRow}>
                  <Text style={styles.rankNumber}>#{row.rank}</Text>
                  <Text numberOfLines={1} style={styles.rankTeam}>{row.team_name}</Text>
                  <Text style={styles.rankPoints}>{Number(row.points || 0).toFixed(1)} pts</Text>
                </View>
              ))}
              {!!leaderboards[c.id].updated_at && <Text style={styles.pointsSub}>Updated {new Date(leaderboards[c.id].updated_at).toLocaleTimeString()}</Text>}
            </View>}
          </View>)}
          {!contests.length && !loading && <Text style={styles.emptySub}>No contests available.</Text>}
          <Pressable style={styles.secondaryBtn} onPress={() => setTab('players')}><Text style={styles.secondaryText}>Create / Update Team</Text></Pressable>
        </>}
      </ScrollView>}

      {tab === 'teams' && <ScrollView contentContainerStyle={styles.content}>
        {teams.length === 0 ? <View style={styles.empty}><Ionicons name="people" size={34} color="#64748B"/><Text style={styles.emptyTitle}>No fantasy teams yet</Text><Pressable style={styles.primaryBtn} onPress={() => setTab('matches')}><Text style={styles.primaryText}>Create your first team</Text></Pressable></View> : teams.map(t => <View key={t.id} style={styles.matchCard}><Text style={styles.matchTitle}>{t.team_name}</Text><Text style={styles.matchSub}>Match ID: {t.match_id}</Text><Text style={styles.matchSub}>{t.player_ids.length}/11 players · {t.credits_used ?? '—'} credits</Text><Text style={styles.matchSub}>C: {t.captain_id} · VC: {t.vice_captain_id}</Text><Pressable style={styles.primaryBtn} onPress={async () => { const m = matches.find(x => x.id === t.match_id); if (m) await openContests(m); else { setSelectedMatch({ id: t.match_id, team_a: { name: 'Selected Match' }, team_b: {} }); await loadContests(t.match_id); setTab('contests'); } }}><Text style={styles.primaryText}>View Contests</Text></Pressable></View>)}
      </ScrollView>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#07111F' }, topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, backgroundColor: '#0B1B2B', borderBottomWidth: 1, borderBottomColor: '#193149' },
  back: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#173047', alignItems: 'center', justifyContent: 'center', marginRight: 10 }, heading: { color: '#F8FAFC', fontSize: 16, fontWeight: '900', letterSpacing: 0.6 }, subheading: { color: '#94A3B8', fontSize: 11, marginTop: 3 }, wallet: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#263247', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 }, walletText: { color: '#FDE68A', fontWeight: '800', fontSize: 12 },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 9, gap: 4, backgroundColor: '#0B1B2B' }, tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 }, tabActive: { backgroundColor: '#14532D' }, tabText: { color: '#94A3B8', fontSize: 11, fontWeight: '700' }, tabTextActive: { color: '#BBF7D0' },
  content: { padding: 14, paddingBottom: 40, gap: 12 }, filterRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingVertical: 12 }, filter: { borderWidth: 1, borderColor: '#294055', borderRadius: 9, paddingVertical: 8, paddingHorizontal: 12 }, filterActive: { backgroundColor: '#14532D', borderColor: '#22C55E' }, filterText: { color: '#94A3B8', fontSize: 10, fontWeight: '800' }, filterTextActive: { color: '#DCFCE7' },
  matchCard: { backgroundColor: '#102236', borderWidth: 1, borderColor: '#1F3A50', borderRadius: 16, padding: 14, gap: 9 }, matchMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, format: { color: '#6EE7B7', fontSize: 10, fontWeight: '900' }, status: { color: '#CBD5E1', fontSize: 10, fontWeight: '800' }, liveStatus: { color: '#F87171' }, matchTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '900' }, matchSub: { color: '#9FB0C3', fontSize: 11, marginTop: 2 }, score: { color: '#FDE68A', fontSize: 12, fontWeight: '800' }, buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 }, primaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16A34A', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 11 }, primaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, secondaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3449', borderWidth: 1, borderColor: '#31516A', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 11 }, secondaryText: { color: '#DDEAF5', fontSize: 12, fontWeight: '800' },
  sectionHeader: { backgroundColor: '#102236', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1F3A50' }, sectionTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '900' }, sectionSub: { color: '#9FB0C3', fontSize: 11, marginTop: 5 }, input: { backgroundColor: '#102236', borderColor: '#29465C', borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 12, color: '#F8FAFC' }, playerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#102236', borderColor: '#1F3A50', borderWidth: 1, borderRadius: 13, padding: 10 }, playerPicked: { borderColor: '#22C55E', backgroundColor: '#102D2A' }, playerAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#263F55', alignItems: 'center', justifyContent: 'center' }, playerInitial: { color: '#E2E8F0', fontWeight: '900' }, playerName: { color: '#F8FAFC', fontSize: 12, fontWeight: '800' }, playerMeta: { color: '#9FB0C3', fontSize: 10, marginTop: 3 }, captainBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#526579', alignItems: 'center', justifyContent: 'center' }, captainSelected: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' }, viceSelected: { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }, captainText: { color: '#CBD5E1', fontSize: 10, fontWeight: '900' }, captainTextSelected: { color: '#111827' }, helper: { color: '#94A3B8', fontSize: 11, lineHeight: 17 }, fullBtn: { marginTop: 4, flex: 0 },
  pointsCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0D3029', borderWidth: 1, borderColor: '#166534', borderRadius: 14, padding: 12 }, pointsTitle: { color: '#A7F3D0', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }, pointsSub: { color: '#9FB0C3', fontSize: 10, marginTop: 4 }, pointsRefresh: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#14532D', alignItems: 'center', justifyContent: 'center' },
  leaderboardBtn: { backgroundColor: '#1D3449', borderWidth: 1, borderColor: '#31516A', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 9 }, leaderboardBtnText: { color: '#D1FAE5', fontSize: 11, fontWeight: '900' }, leaderboardPanel: { width: '100%', marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#081725', borderWidth: 1, borderColor: '#29465C' }, leaderboardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }, leaderboardTitle: { color: '#E2E8F0', fontSize: 10, fontWeight: '900' }, leaderboardState: { color: '#6EE7B7', fontSize: 9, fontWeight: '900' }, rankRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#193149' }, rankNumber: { width: 28, color: '#FDE68A', fontSize: 11, fontWeight: '900' }, rankTeam: { flex: 1, color: '#E2E8F0', fontSize: 11, fontWeight: '700' }, rankPoints: { color: '#6EE7B7', fontSize: 11, fontWeight: '900' },
  contestCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, backgroundColor: '#102236', borderWidth: 1, borderColor: '#1F3A50', borderRadius: 14, padding: 13 }, contestTitle: { color: '#F8FAFC', fontWeight: '900', fontSize: 14 }, contestSub: { color: '#9FB0C3', fontSize: 10, marginTop: 5 }, joinBtn: { backgroundColor: '#16A34A', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }, joinDisabled: { backgroundColor: '#334155' }, joinText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 }, empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42, gap: 10 }, emptyTitle: { color: '#E2E8F0', fontSize: 15, fontWeight: '900' }, emptySub: { color: '#94A3B8', fontSize: 11, textAlign: 'center', lineHeight: 17 }, loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 }, loadingText: { color: '#94A3B8', fontSize: 11 }, errorBox: { marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#451A1A', flexDirection: 'row', gap: 7, alignItems: 'center' }, errorText: { color: '#FECACA', fontSize: 11, flex: 1 }, dismiss: { color: '#FECACA', fontSize: 20, paddingHorizontal: 3 },
});
