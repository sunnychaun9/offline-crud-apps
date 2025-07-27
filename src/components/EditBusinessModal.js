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
} from 'react-native';
import { updateBusiness } from '../database/database';

const EditBusinessModal = ({ visible, business, onClose, onUpdate }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (business) {
      setName(business.name || '');
    }
  }, [business]);

  const handleUpdate = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a business name');
      return;
    }

    if (name.trim() === business?.name) {
      Alert.alert('Info', 'No changes detected');
      return;
    }

    setLoading(true);
    try {
      const updatedBusiness = await updateBusiness(business.id, {
        name: name.trim(),
      });
      
      Alert.alert('Success', 'Business updated successfully');
      onUpdate?.(updatedBusiness.toJSON());
      onClose();
    } catch (error) {
      console.error('Error updating business:', error);
      Alert.alert('Error', `Failed to update business: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (business) {
      setName(business.name || '');
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
          <Text style={styles.title}>Edit Business</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <Text style={styles.label}>Business Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter business name"
            style={styles.input}
            editable={!loading}
            autoFocus
          />

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
        </View>
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
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonSpacer: {
    width: 20,
  },
});

export default EditBusinessModal;