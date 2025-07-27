import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, Button, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { 
  addArticle, 
  getArticlesByBusinessId, 
  getAllBusinesses, 
  deleteArticleWithSync,
  syncStorageWithDatabase
} from '../database/database';
import { v4 as uuidv4 } from 'uuid';
import EditArticleModal from '../components/EditArticleModal';

const ArticleScreen = () => {
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);

  useEffect(() => {
    loadBusinesses();
  }, []);

  useEffect(() => {
    if (selectedBusiness) {
      fetchArticles();
    }
  }, [selectedBusiness]);

  const loadBusinesses = async () => {
    try {
      setLoading(true);
      await syncStorageWithDatabase();
      const result = await getAllBusinesses();
      const list = result.map(doc => doc.toJSON());
      setBusinesses(list);

      if (list.length > 0) {
        setSelectedBusiness(list[0].id);
      }
    } catch (error) {
      console.error('Error loading businesses:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchArticles = async () => {
    if (!selectedBusiness) return;

    try {
      await syncStorageWithDatabase();
      const result = await getArticlesByBusinessId(selectedBusiness);
      const list = result.map(doc => doc.toJSON());
      setArticles(list);
    } catch (error) {
      console.error('Error fetching articles:', error);
      setArticles([]);
    }
  };

  const handleAddArticle = async () => {
    if (!name || !qty || !price || !selectedBusiness) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    try {
      const article = {
        id: uuidv4(),
        name,
        qty: parseInt(qty),
        selling_price: parseFloat(price),
        business_id: selectedBusiness,
      };

      await addArticle(article);

      // Clear form
      setName('');
      setQty('');
      setPrice('');

      // Refresh articles list
      await fetchArticles();
    } catch (error) {
      console.error('Error adding article:', error);
      Alert.alert('Error', 'Error adding article: ' + error.message);
    }
  };

  const handleEditArticle = (article) => {
    setSelectedArticle(article);
    setEditModalVisible(true);
  };

  const handleArticleUpdated = async (updatedArticle) => {
    await fetchArticles();
  };

  const handleDeleteArticle = async (article) => {
    Alert.alert(
      'Delete Article',
      `Delete "${article.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await deleteArticleWithSync(article.id);
              
              if (success) {
                await fetchArticles();
                Alert.alert('Deleted', 'Article deleted successfully');
              } else {
                Alert.alert('Error', 'Article not found');
              }
            } catch (error) {
              console.error('Delete error:', error);
              Alert.alert('Error', `Failed to delete: ${error.message}`);
            }
          }
        }
      ]
    );
  };

  const handleRefresh = async () => {
    await loadBusinesses();
    if (selectedBusiness) {
      await fetchArticles();
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <View style={styles.articleInfo}>
        <Text style={styles.name}>{item.name}</Text>
        <Text>Qty: {item.qty} | ₹{item.selling_price}</Text>
      </View>
      <View style={styles.articleActions}>
        <TouchableOpacity
          onPress={() => handleEditArticle(item)}
          style={styles.actionButton}
        >
          <Text style={styles.editButton}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDeleteArticle(item)}
          style={styles.actionButton}
        >
          <Text style={styles.deleteButton}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading businesses...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Select Business</Text>
        <Button title="🔄" onPress={handleRefresh} />
      </View>

      {businesses.length === 0 ? (
        <View style={styles.noBusinessContainer}>
          <Text style={styles.noBusinessText}>No businesses found!</Text>
          <Text style={styles.noBusinessSubtext}>
            Please go to Business Screen and add a business first.
          </Text>
          <Button title="Refresh" onPress={handleRefresh} />
        </View>
      ) : (
        <>
          <Picker
            selectedValue={selectedBusiness}
            onValueChange={value => setSelectedBusiness(value)}
            style={styles.picker}
          >
            {businesses.map(biz => (
              <Picker.Item label={biz.name} value={biz.id} key={biz.id} />
            ))}
          </Picker>

          <Text style={styles.selectedInfo}>
            Selected: {businesses.find(b => b.id === selectedBusiness)?.name || 'None'}
          </Text>

          <TextInput
            placeholder="Article Name"
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <TextInput
            placeholder="Quantity"
            value={qty}
            onChangeText={setQty}
            keyboardType="numeric"
            style={styles.input}
          />
          <TextInput
            placeholder="Selling Price"
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            style={styles.input}
          />

          <Button title="Add Article" onPress={handleAddArticle} />

          <Text style={styles.title}>Articles ({articles.length})</Text>
          <FlatList
            data={articles}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <Text style={styles.empty}>
                No articles found for this business.{'\n'}
                Add an article above to get started.
              </Text>
            }
          />
        </>
      )}
      <EditArticleModal
        visible={editModalVisible}
        article={selectedArticle}
        onClose={() => {
          setEditModalVisible(false);
          setSelectedArticle(null);
        }}
        onUpdate={handleArticleUpdated}
      />
    </View>
  );
};

export default ArticleScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff'
  },
  loadingText: {
    fontSize: 16,
    color: '#666'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16
  },
  noBusinessContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  noBusinessText: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10
  },
  noBusinessSubtext: {
    fontSize: 14,
    textAlign: 'center',
    color: '#666',
    marginBottom: 20
  },
  picker: {
    backgroundColor: '#eee',
    marginVertical: 8
  },
  selectedInfo: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 10,
    fontStyle: 'italic'
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  item: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    marginVertical: 4,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontWeight: 'bold'
  },
  empty: {
    textAlign: 'center',
    marginTop: 20,
    color: '#666',
    fontStyle: 'italic'
  },
  articleInfo: {
    flex: 1,
  },
  articleActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  editButton: {
    fontSize: 16,
  },
  deleteButton: {
    fontSize: 16,
  },
});