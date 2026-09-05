import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { applyFlexGapCompat } from './flexGapCompat'
import './flex-gap-compat.css'

applyFlexGapCompat()

createApp(App).mount('#app')
