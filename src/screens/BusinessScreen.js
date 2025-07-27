import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import {
  addBusiness,
  getAllBusinesses,
  initDatabase,
  deleteBusiness,
  getSyncStatus,
  getStorageStats,
  syncStorageWithDatabase
} from '../database/database';
import { v4 as uuidv4 } from 'uuid';
import NetInfo from '@react-native-community/netinfo';
import EditBusinessModal from '../components/EditBusinessModal';

const BusinessScreen = () => {
  const [name, setName] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatusState] = useState({
    isOnline: false,
    businessSyncActive: false,
    articleSyncActive: false,
    currentUrl: ''
  });
  const [storageStats, setStorageStats] = useState({
    businesses: 0,
    articles: 0
  });
  const [refreshing, setRefreshing] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize database
      await initDatabase();
      setDbReady(true);

      // Setup network monitoring
      const unsubscribe = NetInfo.addEventListener(state => {
        setIsOnline(state.isConnected);
        setTimeout(updateSyncStatus, 1000);
      });

      // Fetch initial data
      await fetchBusinessesWithSync();
      await updateSyncStatus();

      // Update sync status periodically
      const statusInterval = setInterval(updateSyncStatus, 5000);

      return () => {
        unsubscribe();
        clearInterval(statusInterval);
      };
    } catch (error) {
      console.error('Error initializing app:', error);
      Alert.alert('Error', 'Failed to initialize app: ' + error.message);
    }
  };

  const updateSyncStatus = async () => {
    try {
      const status = getSyncStatus();
      const stats = await getStorageStats();
      setSyncStatusState(status);
      setStorageStats(stats);
    } catch (error) {
      console.error('Error updating sync status:', error);
    }
  };

  const fetchBusinessesWithSync = async () => {
    try {
      await syncStorageWithDatabase();
      const result = await getAllBusinesses();
      const list = result.map(doc => doc.toJSON());
      setBusinesses(list);
      return list;
    } catch (error) {
      console.error('Error fetching businesses:', error);
      setBusinesses([]);
      throw error;
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncStorageWithDatabase();
      await fetchBusinessesWithSync();
      await updateSyncStatus();
    } catch (error) {
      console.error('Error in refresh:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddBusiness = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a business name');
      return;
    }

    if (!dbReady) {
      Alert.alert('Error', 'Database not ready. Please wait...');
      return;
    }

    try {
      const businessData = {
        id: uuidv4(),
        name: name.trim(),
      };

      await addBusiness(businessData);
      setName('');

      await fetchBusinessesWithSync();
      await updateSyncStatus();

      const syncMessage = isOnline && syncStatus.businessSyncActive ?
        ' (Syncing to server...)' :
        ' (Will sync when online)';

      Alert.alert(
        'Success',
        `Business "${businessData.name}" added successfully!${syncMessage}`
      );
    } catch (error) {
      console.error('Error adding business:', error);
      Alert.alert('Error', 'Failed to add business: ' + error.message);
    }
  };

  const handleEditBusiness = (business) => {
    setSelectedBusiness(business);
    setEditModalVisible(true);
  };

  const handleBusinessUpdated = async (updatedBusiness) => {
    await fetchBusinessesWithSync();
    await updateSyncStatus();
  };

  const handleDelete = async (id) => {
    Alert.alert(
      'Delete Business',
      'Are you sure you want to delete this business?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await initDatabase();
              const doc = await db.businesses.findOne({ selector: { id } }).exec();
              if (doc) {
                await deleteBusiness(doc);
                await fetchBusinessesWithSync();
                await updateSyncStatus();
              }
            } catch (error) {
              console.error('Error deleting business:', error);
              Alert.alert('Error', 'Failed to delete business: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const getSyncStatusText = () => {
    if (!dbReady) return '🔧 Initializing...';
    if (!syncStatus.isOnline) return '📱 Offline Mode';
    if (syncStatus.businessSyncActive || syncStatus.articleSyncActive) return '🔄 Syncing...';
    return '✅ Online & Ready';
  };

  const getSyncStatusColor = () => {
    if (!dbReady) return '#9E9E9E';
    if (!syncStatus.isOnline) return '#FF9800';
    if (syncStatus.businessSyncActive || syncStatus.articleSyncActive) return '#2196F3';
    return '#4CAF50';
  };

  const renderItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <View style={styles.businessInfo}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.id}>ID: {item.id.substring(0, 8)}...</Text>
      </View>
      <View style={styles.actionButtons}>
        <TouchableOpacity
          onPress={() => handleEditBusiness(item)}
          style={styles.actionButton}
        >
          <Text style={styles.editButton}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDelete(item.id)}
          style={styles.actionButton}
        >
          <Text style={styles.delete}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Status Bar */}
      <View style={[styles.statusBar, { backgroundColor: getSyncStatusColor() }]}>
        <Text style={styles.statusText}>{getSyncStatusText()}</Text>
      </View>

      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          📦 {storageStats.businesses} Businesses | 🧾 {storageStats.articles} Articles
        </Text>
      </View>

      <View style={styles.content}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Enter business name"
          style={styles.input}
          editable={dbReady}
        />
        <Button
          title="Add Business"
          onPress={handleAddBusiness}
          disabled={!dbReady}
        />

        <Text style={styles.heading}>📦 Business List ({businesses.length})</Text>
        <FlatList
          data={businesses}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {!dbReady ? 'Initializing database...' : 'No businesses added yet.'}
              {'\n'}
              {!isOnline && 'Data will sync when you go online.'}
            </Text>
          }
        />
      </View>

      <EditBusinessModal
        visible={editModalVisible}
        business={selectedBusiness}
        onClose={() => {
          setEditModalVisible(false);
          setSelectedBusiness(null);
        }}
        onUpdate={handleBusinessUpdated}
      />
    </View>
  );
};

export default BusinessScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  statusBar: {
    padding: 12,
  },
  statusText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
    textAlign: 'center',
  },
  statsBar: {
    backgroundColor: '#f5f5f5',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statsText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  heading: {
    fontSize: 18,
    marginVertical: 10,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  itemContainer: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  businessInfo: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  id: {
    fontSize: 12,
    color: 'gray',
    marginTop: 2,
  },
  delete: {
    fontSize: 18,
    padding: 8,
  },
  empty: {
    textAlign: 'center',
    marginTop: 20,
    color: 'gray',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  editButton: {
    fontSize: 18,
  },
});