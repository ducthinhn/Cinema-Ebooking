<template>
  <router-view :key="routerViewKey" />
  <IdleWarningModal v-if="isLoggedIn" :show="showWarning" :countdown="countdown" @stay="stayLoggedIn"
    @logout="handleLogout" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useRouter } from 'vue-router'
import { useUIStore } from './stores/ui.store'
import { useIdleTimeout } from '@/composables/useIdleTimeout'
import IdleWarningModal from '@/components/common/IdleWarningModal.vue'

const authStore = useAuthStore()
const uiStore = useUIStore()
const router = useRouter()
const routerViewKey = ref(0)

const isLoggedIn = computed(() => !!authStore.accessToken)

const handleLogout = async () => {
  await authStore.logout()
  const currentRoute = router.currentRoute.value
  if (currentRoute.meta?.requiresAuth) {
    await router.push('/')
  } else {
    routerViewKey.value++
  }
  uiStore.openLoginModal()
}

const { showWarning, countdown, stayLoggedIn } = useIdleTimeout(handleLogout)
</script>