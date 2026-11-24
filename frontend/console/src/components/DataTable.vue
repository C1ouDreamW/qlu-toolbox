<script setup lang="ts">
defineProps<{ headers: string[]; rows: (string | number)[][] }>()
</script>

<template>
  <div class="table-scroll" tabindex="0">
    <table>
      <thead><tr><th v-for="header in headers" :key="header" scope="col">{{ header }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <td v-for="(value, column) in row" :key="column">{{ value }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
