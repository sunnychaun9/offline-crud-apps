// src/config/environment.js - Updated with your working IP first
import { Platform } from 'react-native';

const isDevelopment = __DEV__;

const ENVIRONMENTS = {
  development: {
    couchdb: {
      possibleUrls: [
        Platform.OS === 'android' ? 'http://10.0.2.2:5984' : 'http://localhost:5984',
        'http://192.168.1.100:5984', // YOUR WORKING IP - FIRST
        'http://192.168.1.101:5984',
        'http://192.168.1.102:5984',
        'http://192.168.0.100:5984',
        'http://192.168.0.101:5984',
      ],
      businessesDB: 'businesses',
      articlesDB: 'articles',
      username: 'shani',
      password: 'shani@123456',
      timeout: 5000
    },
    app: {
      name: 'BusinessApp Dev',
      version: '1.0.0-dev'
    }
  },
  production: {
    couchdb: {
      possibleUrls: [
        'http://192.168.1.100:5984', // YOUR WORKING IP - FIRST FOR APK
        'http://192.168.1.101:5984',
        'http://192.168.1.102:5984',
        'http://192.168.1.103:5984',
        'http://192.168.1.104:5984',
        'http://192.168.1.105:5984',
        'http://192.168.0.100:5984',
        'http://192.168.0.101:5984',
        'http://192.168.0.102:5984',
        'http://192.168.0.103:5984',
        'http://192.168.0.104:5984',
        'http://192.168.0.105:5984',
      ],
      businessesDB: 'businesses',
      articlesDB: 'articles',
      username: 'shani',
      password: 'shani@123456',
      timeout: 8000 // Longer timeout for production
    },
    app: {
      name: 'BusinessApp',
      version: '1.0.0'
    }
  }
};

export const config = ENVIRONMENTS[isDevelopment ? 'development' : 'production'];

export const getEnvironmentName = () => isDevelopment ? 'development' : 'production';
export const isDev = () => isDevelopment;