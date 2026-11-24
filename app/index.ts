import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { headlessCommandTask } from './src/core/headless';

// Started by the native voice session (EdjiCommandTaskService), with or without the app open.
AppRegistry.registerHeadlessTask('EdjiCommand', () => headlessCommandTask);

registerRootComponent(App);
