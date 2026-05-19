/**
 * StateManager - Centralized state management
 */
export class StateManager {
  constructor() {
    this.state = {
      // UI state
      chatVisible: true,
      settingsOpen: false,
      
      // VRM state
      currentVRM: 'saneko', // 'saneko' or 'male'
      vrmLoaded: false,
      
      // Audio state
      isSpeaking: false,
      isListening: false,
      
      // AI state
      isProcessing: false,
      currentPersona: 'general',
      
      // Message state
      lastUserMessage: '',
      lastAIMessage: '',
      messageHistory: []
    };
    
    this.listeners = {};
    console.log('🗃️ StateManager initialized');
  }
  
  /**
   * Set state at a specific path
   * @param {string} path - Dot-notation path to state property
   * @param {any} value - New value
   */
  setState(path, value) {
    // Update state at path
    const pathParts = path.split('.');
    let current = this.state;
    
    // Navigate to the parent of the target property
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (current[pathParts[i]] === undefined) {
        current[pathParts[i]] = {};
      }
      current = current[pathParts[i]];
    }
    
    // Update the target property
    const lastKey = pathParts[pathParts.length - 1];
    const oldValue = current[lastKey];
    current[lastKey] = value;
    
    // Notify listeners
    if (this.listeners[path]) {
      this.listeners[path].forEach(callback => {
        try {
          callback(value, oldValue);
        } catch (error) {
          console.error(`Error in state listener for ${path}:`, error);
        }
      });
    }
  }
  
  /**
   * Get state value at path
   * @param {string} path - Dot-notation path to state property
   * @returns {any} - Value at path
   */
  getState(path) {
    const pathParts = path.split('.');
    let current = this.state;
    
    for (const part of pathParts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    
    return current;
  }
  
  /**
   * Subscribe to changes at a specific path
   * @param {string} path - Dot-notation path to state property
   * @param {function} callback - Function to call when value changes
   * @returns {function} - Unsubscribe function
   */
  subscribe(path, callback) {
    if (!this.listeners[path]) {
      this.listeners[path] = [];
    }
    
    this.listeners[path].push(callback);
    return () => {
      this.listeners[path] = this.listeners[path].filter(cb => cb !== callback);
    };
  }
}

