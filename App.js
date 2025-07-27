import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import BusinessScreen from './src/screens/BusinessScreen';
import ArticleScreen from './src/screens/ArticleScreen';
import Icon from 'react-native-vector-icons/Ionicons';

const Tab = createBottomTabNavigator();

const App = () => {
  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="Businesses"
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, size }) => {
            let iconName;
            if (route.name === 'Businesses') {
              iconName = 'business-outline';
            } else if (route.name === 'Articles') {
              iconName = 'newspaper-outline';
            }
            return <Icon name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor: '#007bff',
          tabBarInactiveTintColor: 'gray',
        })}
      >
        <Tab.Screen name="Businesses" component={BusinessScreen} />
        <Tab.Screen name="Articles" component={ArticleScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

export default App;