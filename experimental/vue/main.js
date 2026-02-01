import { createApp } from 'vue'
import Card from './Card.vue'

/**
 * Mounts a Vue Component into a container.
 * This is a bridge function to be called from the Vanilla JS host.
 * 
 * @param {HTMLElement} container 
 * @param {Object} props 
 */
export function mountCard(container, props) {
    const app = createApp(Card, props);
    app.mount(container);
    return app;
}

export { Card };
