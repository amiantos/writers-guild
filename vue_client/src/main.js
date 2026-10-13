import { createApp } from 'vue';
import App from './App.vue';
import router, { goToSignIn } from './router';
import { installAuthFetch } from './services/authApi';
import './style.css';

installAuthFetch(goToSignIn);

const app = createApp(App);

app.use(router);
app.mount('#app');
