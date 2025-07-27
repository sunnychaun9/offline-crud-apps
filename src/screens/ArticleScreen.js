import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, Button, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { initDatabase, addArticle, getArticlesByBusinessId, getAllBusinesses } from '../database/database';
import { v4 as uuidv4 } from 'uuid';

const ArticleScreen = () => {
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');

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
      console.log('🔄 Loading businesses...');
      
      // Use the proper database function that handles AsyncStorage loading
      const result = await getAllBusinesses();
      const list = result.map(doc => doc.toJSON());
      
      console.log('📈 Businesses loaded in ArticleScreen:', list);
      setBusinesses(list);

      if (list.length > 0) {
        setSelectedBusiness(list[0].id);
        console.log('🎯 Selected first business:', list[0].id, list[0].name);
      } else {
        console.log('⚠️ No businesses found');
      }
    } catch (error) {
      console.error('❌ Error loading businesses in ArticleScreen:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchArticles = async () => {
    if (!selectedBusiness) return;

    try {
      console.log('🔍 Fetching articles for business:', selectedBusiness);
      const result = await getArticlesByBusinessId(selectedBusiness);
      const list = result.map(doc => doc.toJSON());
      console.log('🧾 Articles fetched for', selectedBusiness, list);
      setArticles(list);
    } catch (error) {
      console.error('❌ Error fetching articles:', error);
      setArticles([]);
    }
  };

  const handleAddArticle = async () => {
    if (!name || !qty || !price || !selectedBusiness) {
      alert('Please fill all fields');
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
      
      console.log('➕ Adding article:', article);
      await addArticle(article);
      console.log('✅ Article added successfully');

      // Clear form
      setName('');
      setQty('');
      setPrice('');
      
      // Refresh articles list
      fetchArticles();
    } catch (error) {
      console.error('❌ Error adding article:', error);
      alert('Error adding article: ' + error.message);
    }
  };

  const handleRefresh = () => {
    console.log('🔄 Refreshing data...');
    loadBusinesses();
  };

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <Text style={styles.name}>{item.name}</Text>
      <Text>Qty: {item.qty} | ₹{item.selling_price}</Text>
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
            onValueChange={value => {
              console.log('👆 Business selected:', value);
              setSelectedBusiness(value);
            }}
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
});