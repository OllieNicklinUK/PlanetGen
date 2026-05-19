/**
 * EventBus - Simple event system for module communication
 */
export class EventBus {
  constructor() {
    this.events = {};
    console.log('📣 EventBus initialized');
  }
  
  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {function} callback - Function to call when event is emitted
   * @returns {function} - Unsubscribe function
   */
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    
    this.events[event].push(callback);
    return () => this.off(event, callback);
  }
  
  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {function} callback - Function to remove
   */
  off(event, callback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }
  
  /**
   * Emit an event with data
   * @param {string} event - Event name
   * @param {any} data - Data to pass to callbacks
   */
  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }
}

