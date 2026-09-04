// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue') },
    { path: '/monthly-setup', name: 'monthly-setup', component: () => import('@/views/MonthlySetup.vue') },
    { path: '/employees', name: 'employees', component: () => import('@/views/Employees.vue') },
    { path: '/leave-requests', name: 'leave-requests', component: () => import('@/views/LeaveRequests.vue') },
    { path: '/schedule', name: 'schedule', component: () => import('@/views/Schedule.vue') }
  ]
})

export default router