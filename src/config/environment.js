// src/config/environment.js
import { Platform } from 'react-native';

const isDevelopment = __DEV__;

const ENVIRONMENTS = {
  development: {
    couchdb: {
      possibleUrls: [
        Platform.OS === 'android' ? 'http://10.0.2.2:5984' : 'http://localhost:5984',
        'http://192.168.1.100:5984', // Replace with your actual IP
        'http://192.168.0.100:5984',
        'http://192.168.1.101:5984',
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
        'https://your-production-couchdb.com',
      ],
      businessesDB: 'businesses',
      articlesDB: 'articles',
      username: 'admin', // Use env vars in production
      password: 'password',
      timeout: 10000
    },
    app: {
      name: 'BusinessApp',
      version: '1.0.0'
    }
  }
};

export const config = ENVIRONMENTS[isDevelopment ? 'development' : 'production'];

// Helper function to get current environment name
export const getEnvironmentName = () => isDevelopment ? 'development' : 'production';

// Helper to check if we're in development
export const isDev = () => isDevelopment;