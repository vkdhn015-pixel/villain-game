import React, { useState } from 'react';
import {
View,
Text,
StyleSheet,
TextInput,
Pressable,
Alert,
ActivityIndicator,
ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api';

export default function SendCoinsScreen() {
const router = useRouter();

const [search, setSearch] = useState('');
const [users, setUsers] = useState<any[]>([]);
const [selectedUser, setSelectedUser] = useState<any>(null);
const [amount, setAmount] = useState('');
const [reason, setReason] = useState('Admin Bonus');
const [loading, setLoading] = useState(false);
const [searching, setSearching] = useState(false);

const searchUsers = async () => {
const query = search.trim();

if (!query) {
  Alert.alert('Required', 'User ID, UID, phone ya name daalein.');
  return;
}

setSearching(true);
setSelectedUser(null);
setUsers([]);

try {
  const result = await api.adminUsers(query);
  const list = Array.isArray(result)
    ? result
    : result?.users || [];

  setUsers(list);

  if (list.length === 0) {
    Alert.alert('User Not Found', 'Koi user nahi mila.');
  } else if (list.length === 1) {
    setSelectedUser(list[0]);
  }
} catch (error: any) {
  Alert.alert(
    'Search Failed',
    error?.message || 'Users load nahi hue.'
  );
} finally {
  setSearching(false);
}

};

const sendCoins = () => {
if (!selectedUser) {
Alert.alert(
'Select User',
'Pehle Search User karke user select karein.'
);
return;
}

const coins = Number(amount);

if (!Number.isSafeInteger(coins) || coins <= 0) {
  Alert.alert(
    'Invalid Amount',
    'Coins ki sankhya 1 ya usse zyada poori sankhya honi chahiye.'
  );
  return;
}

if (coins > 100000000) {
  Alert.alert('Invalid Amount', 'Coins ki sankhya bahut zyada hai.');
  return;
}

const internalId = selectedUser.id;

if (!internalId) {
  Alert.alert(
    'User ID Missing',
    'User ka internal ID nahi mila. Backend response check karein.'
  );
  return;
}

Alert.alert(
  'Confirm Coin Transfer',
  `${coins} coins bhejein?\n\nName: ${selectedUser.name || 'N/A'}\nUID: ${selectedUser.uid || 'N/A'}\nCurrent Balance: ${selectedUser.balance ?? 0}`,
  [
    {
      text: 'Cancel',
      style: 'cancel',
    },
    {
      text: 'Confirm Send',
      onPress: async () => {
        setLoading(true);

        try {
          const updated = await api.adminAdjust(
            internalId,
            coins,
            reason.trim() || 'Admin Bonus'
          );

          Alert.alert(
            'Coins Sent Successfully',
            `Coins: ${coins}\nNew Balance: ${updated?.balance ?? 'Updated'}`
          );

          setSearch('');
          setUsers([]);
          setSelectedUser(null);
          setAmount('');
          setReason('Admin Bonus');
        } catch (error: any) {
          Alert.alert(
            'Transfer Failed',
            error?.message || 'Coin transfer nahi ho saka.'
          );
        } finally {
          setLoading(false);
        }
      },
    },
  ]
);

};

return (
<View style={styles.container}>
<LinearGradient
colors={['#111827', '#26354D']}
style={styles.header}
>
<SafeAreaView edges={['top']}>
<View style={styles.headerRow}>
<Pressable
onPress={() => router.back()}
style={styles.backButton}
>
<Ionicons
name="arrow-back"
size={23}
color="#FFFFFF"
/>
</Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Send Coins</Text>
          <Text style={styles.headerSubtitle}>
            Admin Wallet Management
          </Text>
        </View>

        <Ionicons
          name="wallet"
          size={28}
          color="#FFD700"
        />
      </View>
    </SafeAreaView>
  </LinearGradient>

  <ScrollView
    contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled"
  >
    <View style={styles.infoCard}>
      <Ionicons
        name="shield-checkmark"
        size={25}
        color="#2ECA7F"
      />

      <View style={{ flex: 1 }}>
        <Text style={styles.infoTitle}>
          Admin Coin Transfer
        </Text>
        <Text style={styles.infoText}>
          User search karein, sahi user select karein aur coins bhejein.
        </Text>
      </View>
    </View>

    <View style={styles.card}>
      <Text style={styles.label}>Search User</Text>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="UID / phone / name / internal ID"
        placeholderTextColor="#8992A6"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        editable={!searching && !loading}
        onSubmitEditing={searchUsers}
        returnKeyType="search"
      />

      <Pressable
        onPress={searchUsers}
        disabled={searching || loading}
        style={[
          styles.searchButton,
          (searching || loading) && styles.disabledButton,
        ]}
      >
        {searching ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Ionicons
              name="search"
              size={19}
              color="#FFFFFF"
            />
            <Text style={styles.buttonText}>
              Search User
            </Text>
          </>
        )}
      </Pressable>

      {users.map((user, index) => (
        <Pressable
          key={String(user.id || user.uid || index)}
          onPress={() => setSelectedUser(user)}
          style={[
            styles.userRow,
            selectedUser?.id === user.id &&
              styles.selectedUser,
          ]}
        >
          <Ionicons
            name={
              selectedUser?.id === user.id
                ? 'radio-button-on'
                : 'person-circle'
            }
            size={28}
            color={
              selectedUser?.id === user.id
                ? '#2ECA7F'
                : '#64748B'
            }
          />

          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>
              {user.name || 'Unnamed User'}
            </Text>
            <Text style={styles.userMeta}>
              UID: {user.uid || 'N/A'}
            </Text>
            <Text style={styles.userMeta}>
              Internal ID: {user.id || 'N/A'}
            </Text>
            <Text style={styles.userBalance}>
              Balance: {user.balance ?? 0}
            </Text>
          </View>

          {selectedUser?.id === user.id && (
            <Ionicons
              name="checkmark-circle"
              size={23}
              color="#2ECA7F"
            />
          )}
        </Pressable>
      ))}

      {selectedUser && (
        <View style={styles.selectedBox}>
          <Text style={styles.selectedTitle}>
            Selected User
          </Text>
          <Text style={styles.selectedText}>
            {selectedUser.name || 'Unnamed User'}
          </Text>
          <Text style={styles.selectedText}>
            UID: {selectedUser.uid || 'N/A'}
          </Text>
          <Text style={styles.selectedText}>
            Current Balance: {selectedUser.balance ?? 0}
          </Text>
        </View>
      )}

      <Text style={styles.label}>Coins Amount</Text>

      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="e.g. 500"
        placeholderTextColor="#8992A6"
        keyboardType="number-pad"
        style={styles.input}
        editable={!loading}
      />

      <Text style={styles.label}>Reason</Text>

      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Admin Bonus / Reward"
        placeholderTextColor="#8992A6"
        style={styles.input}
        editable={!loading}
        maxLength={160}
      />

      <Pressable
        onPress={sendCoins}
        disabled={loading}
        style={[
          styles.sendButton,
          loading && styles.disabledButton,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Ionicons
              name="gift"
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.buttonText}>
              Send Coins
            </Text>
          </>
        )}
      </Pressable>

      <Text style={styles.footnote}>
        Confirm karne se pehle user aur coins amount verify karein.
      </Text>
    </View>
  </ScrollView>
</View>

);
}

const styles = StyleSheet.create({
container: {
flex: 1,
backgroundColor: '#F2F5FA',
},
header: {
paddingHorizontal: 18,
paddingBottom: 18,
},
headerRow: {
flexDirection: 'row',
alignItems: 'center',
gap: 13,
paddingTop: 10,
},
backButton: {
width: 42,
height: 42,
borderRadius: 13,
alignItems: 'center',
justifyContent: 'center',
backgroundColor: 'rgba(255,255,255,0.12)',
},
headerTitle: {
color: '#FFFFFF',
fontSize: 23,
fontWeight: '900',
},
headerSubtitle: {
color: '#CBD5E1',
fontSize: 12,
marginTop: 3,
},
content: {
padding: 16,
paddingBottom: 40,
maxWidth: 760,
width: '100%',
alignSelf: 'center',
},
infoCard: {
flexDirection: 'row',
alignItems: 'center',
gap: 12,
backgroundColor: '#FFFFFF',
padding: 16,
borderRadius: 16,
marginBottom: 16,
},
infoTitle: {
color: '#152238',
fontWeight: '900',
fontSize: 15,
},
infoText: {
color: '#64748B',
fontSize: 12,
marginTop: 4,
lineHeight: 18,
},
card: {
backgroundColor: '#FFFFFF',
borderRadius: 18,
padding: 18,
},
label: {
color: '#172033',
fontSize: 13,
fontWeight: '800',
marginTop: 15,
marginBottom: 7,
},
input: {
minHeight: 48,
borderWidth: 1,
borderColor: '#DCE3EE',
borderRadius: 11,
paddingHorizontal: 13,
color: '#172033',
backgroundColor: '#FAFBFD',
},
searchButton: {
minHeight: 46,
marginTop: 10,
borderRadius: 11,
backgroundColor: '#5269E8',
flexDirection: 'row',
alignItems: 'center',
justifyContent: 'center',
gap: 8,
},
disabledButton: {
opacity: 0.6,
},
userRow: {
flexDirection: 'row',
alignItems: 'center',
gap: 10,
padding: 12,
marginTop: 10,
borderWidth: 1,
borderColor: '#E1E7F0',
borderRadius: 12,
backgroundColor: '#FFFFFF',
},
selectedUser: {
borderColor: '#2ECA7F',
backgroundColor: '#F0FFF7',
},
userName: {
color: '#172033',
fontSize: 14,
fontWeight: '800',
},
userMeta: {
color: '#64748B',
fontSize: 11,
marginTop: 3,
},
userBalance: {
color: '#168552',
fontSize: 12,
fontWeight: '800',
marginTop: 4,
},
selectedBox: {
backgroundColor: '#F0FFF7',
borderColor: '#B8E9CF',
borderWidth: 1,
borderRadius: 12,
padding: 12,
marginTop: 14,
},
selectedTitle: {
color: '#168552',
fontSize: 12,
fontWeight: '900',
},
selectedText: {
color: '#245B41',
fontSize: 12,
marginTop: 4,
},
sendButton: {
minHeight: 50,
marginTop: 22,
borderRadius: 12,
backgroundColor: '#16A765',
flexDirection: 'row',
alignItems: 'center',
justifyContent: 'center',
gap: 9,
},
buttonText: {
color: '#FFFFFF',
fontSize: 15,
fontWeight: '900',
},
footnote: {
color: '#7B879A',
fontSize: 11,
marginTop: 12,
lineHeight: 17,
},
});