clone the repository using https://github.com/sunnychaun9/offline-crud-apps.git

find the branch named 'sqlite' and took this 

Prerequisites

Node.js (v16 or higher)
React Native CLI or Expo CLI
Android Studio (for Android development)
Xcode (for iOS development - macOS only)
CouchDB Server (local or cloud instance)

for couDB sync up got to src/database/config.js

export const COUCHDB_CONFIG = {
  // For local CouchDB
  url: 'http://localhost:5984',
  // username: 'your-username',
  // password: 'your-password'
};

All data operations (Create, Read, Update, Delete) are performed on the local SQLite database first


If you found any run time error please apply below commands 

npx react-native start --reset-cache
cd android && ./gradlew clean && cd ..
rm -rf node_modules && npm install

Clear app data: Settings → Apps → Your App → Storage → Clear Data