// Must come first: the AI SDK needs these globals in the app and in the headless task.
import './src/polyfills';

import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './src/App';
import { headlessCommandTask } from './src/core/headless';

// Started by the native voice session (EdjiCommandTaskService), with or without the app open.
AppRegistry.registerHeadlessTask('EdjiCommand', () => headlessCommandTask);

registerRootComponent(App);
