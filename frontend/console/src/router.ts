import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: { name: 'overview' } },
    { path: '/overview', name: 'overview', component: () => import('./views/OverviewView.vue') },
    { path: '/feedback', name: 'feedback', alias: '/feedback-title', component: () => import('./views/FeedbackView.vue') },
    { path: '/publish', name: 'publish', alias: ['/distribution', '/announcement'], component: () => import('./views/PublishView.vue') },
    { path: '/stats', name: 'stats', component: () => import('./views/StatisticsView.vue') },
    { path: '/operations', name: 'operations', component: () => import('./views/OperationsView.vue') },
    { path: '/account', name: 'account', component: () => import('./views/AccountView.vue') },
    { path: '/:pathMatch(.*)*', redirect: { name: 'overview' } },
  ],
})
