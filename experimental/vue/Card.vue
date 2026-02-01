<template>
  <div 
    class="mjr-asset-card" 
    :class="{ 'is-selected': isSelected, 'has-collision': hasCollision }"
    @click="$emit('select', asset)"
    @dblclick="$emit('open', asset)"
    :data-asset-id="asset.id"
  >
    <div class="mjr-thumb">
      <img 
        v-if="isImage" 
        :src="thumbnailUrl" 
        loading="lazy" 
        alt="Asset thumbnail"
      />
      <video
        v-else-if="isVideo"
        :src="previewUrl"
        muted
        loop
        playsinline
        class="mjr-thumb-media"
      />
      
      <!-- Badges -->
      <div v-if="rating > 0" class="mjr-rating-badge">
        <span v-for="n in rating" :key="n" class="star">★</span>
      </div>
      
      <div v-if="formatBadge" class="mjr-file-badge">
        {{ formatBadge }}
      </div>
    </div>

    <div class="mjr-card-info" v-if="showDetails">
      <div class="mjr-card-filename" :title="asset.filename">
        {{ asset.filename }}
      </div>
      <div class="mjr-card-meta">
        {{ formattedDate }}
        <span v-if="hasWorkflow" class="mjr-workflow-dot" title="Has Workflow"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTS } from './src/utils/formatting';

interface Asset {
  id: string;
  filename: string;
  type: string; // 'image' | 'video'
  url: string;
  rating?: number;
  tags?: string[];
  mtime: number;
  hasWorkflow?: boolean;
}

const props = defineProps<{
  asset: Asset;
  isSelected: boolean;
  showDetails: boolean;
}>();

defineEmits(['select', 'open']);

const isImage = computed(() => props.asset.type === 'image');
const isVideo = computed(() => props.asset.type === 'video');

const thumbnailUrl = computed(() => `/view?filename=${encodeURIComponent(props.asset.filename)}&type=input`);
const previewUrl = computed(() => props.asset.url); // Simplified

const rating = computed(() => Math.min(5, Math.max(0, props.asset.rating || 0)));

const formatBadge = computed(() => {
  const ext = props.asset.filename.split('.').pop()?.toUpperCase();
  return ext || '';
});

const hasCollision = computed(() => false); // Logic to come from props

const formattedDate = computed(() => {
  return formatDateTS(props.asset.mtime);
});
</script>

<style scoped>
.mjr-asset-card {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--mjr-surface-2);
  border-radius: var(--mjr-r-md);
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.1s;
}

.mjr-asset-card.is-selected {
  border-color: var(--mjr-accent);
}

.mjr-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* ... rest of styles ... */
</style>
