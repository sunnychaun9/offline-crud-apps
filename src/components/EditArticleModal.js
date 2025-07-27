import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { updateArticleData, getAllBusinesses } from '../database/database';

const EditArticleModal = ({ visible, article, onClose, onUpdate }) => {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      loadBusinesses();
    }
  }, [visible]);

  useEffect(() => {
    if (article) {
      setName(article.name || '');
      setQty(article.qty?.toString() || '');
      setPrice(article.selling_price?.toString() || '');
      setBusinessId(article.business_id || '');
    }
  }, [article]);

  const loadBusinesses = async () => {
    try {
      const result = await getAllBusinesses();
      const businessList = result.map(doc => doc.toJSON());
      setBusinesses(businessList);
    } catch (error) {
      console.error('Error loading businesses:', error);
    }
  };

  const validateForm = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter article name');
      return false;
    }
    if (!qty || isNaN(qty) || parseInt(qty) <= 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return false;
    }
    if (!price || isNaN(price) || parseFloat(price) <= 0) {
      Alert.alert('Error', 'Please enter a valid price');
      return false;
    }
    if (!businessId) {
      Alert.alert('Error', 'Please select a business');
      return false;
    }
    return true;
  };

  const hasChanges = () => {
    if (!article) return false;
    return (
      name.trim() !== article.name ||
      parseInt(qty) !== article.qty ||
      parseFloat(price) !== article.selling_price ||
      businessId !== article.business_id
    );
  };

  const handleUpdate = async () => {
    if (!validateForm()) return;

    if (!hasChanges()) {
      Alert.alert('Info', 'No changes detected');
      return;
    }

    setLoading(true);
    try {
      const updatedArticle = await updateArticleData(article.id, {
        name: name.trim(),
        qty: parseInt(qty),
        selling_price: parseFloat(price),
        business_id: businessId,
      });
      
      Alert.alert('Success', 'Article updated successfully');
      onUpdate?.(updatedArticle.toJSON());
      onClose();
    } catch (error) {
      console.error('Error updating article:', error);
      Alert.alert('Error', `Failed to update article: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (article) {
      setName(article.name || '');
      setQty(article.qty?.toString() || '');
      setPrice(article.selling_price?.toString() || '');
      setBusinessId(article.business_id || '');
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Article</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <Text style={styles.label}>Article Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter article name"
            style={styles.input}
            editable={!loading}
          />

          <Text style={styles.label}>Quantity</Text>
          <TextInput
            value={qty}
            onChangeText={setQty}
            placeholder="Enter quantity"
            keyboardType="numeric"
            style={styles.input}
            editable={!loading}
          />

          <Text style={styles.label}>Selling Price</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="Enter selling price"
            keyboardType="numeric"
            style={styles.input}
            editable={!loading}
          />

          <Text style={styles.label}>Business</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={businessId}
              onValueChange={setBusinessId}
              style={styles.picker}
              enabled={!loading}
            >
              <Picker.Item label="Select a business..." value="" />
              {businesses.map(business => (
                <Picker.Item
                  key={business.id}
                  label={business.name}
                  value={business.id}
                />
              ))}
            </Picker>
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title="Cancel"
              onPress={handleClose}
              color="#666"
              disabled={loading}
            />
            <View style={styles.buttonSpacer} />
            <Button
              title={loading ? "Updating..." : "Update"}
              onPress={handleUpdate}
              disabled={loading}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 8,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    marginBottom: 8,
  },
  picker: {
    height: 50,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    paddingBottom: 20,
  },
  buttonSpacer: {
    width: 20,
  },
});

export default EditArticleModal;