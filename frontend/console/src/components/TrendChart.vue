<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { numberFormat } from '../ui'

const props = defineProps<{ dates: string[]; values: number[]; label: string }>()
const canvas = ref<HTMLCanvasElement>()
const selected = ref(0)
const axisFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
let observer: ResizeObserver | undefined
let plotLeft = 0
let plotWidth = 0

function draw() {
  const element = canvas.value
  const context = element?.getContext('2d')
  if (!element || !context || !props.dates.length) return

  const width = element.clientWidth
  const height = element.clientHeight
  if (!width || !height) return
  const pixelRatio = window.devicePixelRatio || 1
  element.width = Math.round(width * pixelRatio)
  element.height = Math.round(height * pixelRatio)
  context.scale(pixelRatio, pixelRatio)

  const maximum = Math.max(1, ...props.values)
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(maximum / 4)))
  const step = Math.ceil(maximum / (4 * magnitude)) * magnitude
  const intervals = Math.ceil(maximum / step)
  const ceiling = intervals * step
  const top = 18
  const bottom = height - 34
  const count = props.dates.length
  context.font = '12px system-ui, sans-serif'
  const labels = Array.from({ length: intervals + 1 }, (_, index) => axisFormat.format(step * index))
  plotLeft = Math.max(...labels.map(label => context.measureText(label).width)) + 14
  plotWidth = width - plotLeft - 18
  const x = (index: number) => plotLeft + plotWidth * (count === 1 ? 0.5 : index / (count - 1))
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top)

  context.strokeStyle = '#e1e8f3'
  context.fillStyle = '#526078'
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  for (const [index, label] of labels.entries()) {
    const line = y(index * step)
    context.beginPath()
    context.moveTo(plotLeft, line)
    context.lineTo(plotLeft + plotWidth, line)
    context.stroke()
    context.fillText(label, plotLeft - 9, line)
  }

  const labelCount = Math.max(2, Math.floor(plotWidth / 80))
  const dates = new Set(Array.from({ length: labelCount }, (_, index) =>
    Math.round(index * (count - 1) / (labelCount - 1))))
  for (const index of dates) {
    context.textAlign = count === 1 ? 'center' : index === 0 ? 'left' : index === count - 1 ? 'right' : 'center'
    context.fillText(props.dates[index].slice(5), x(index), bottom + 18)
  }

  if (count > 1) {
    const points = new Path2D()
    props.values.forEach((value, index) => {
      if (index === 0) points.moveTo(x(index), y(value))
      else points.lineTo(x(index), y(value))
    })
    const area = new Path2D(points)
    area.lineTo(x(count - 1), bottom)
    area.lineTo(x(0), bottom)
    area.closePath()
    const fill = context.createLinearGradient(0, top, 0, bottom)
    fill.addColorStop(0, '#2763de35')
    fill.addColorStop(1, '#2763de05')
    context.fillStyle = fill
    context.fill(area)
    context.lineJoin = 'round'
    context.lineWidth = 2.5
    context.strokeStyle = '#2459cd'
    context.stroke(points)
  }

  const pointX = x(selected.value)
  const pointY = y(props.values[selected.value] ?? 0)
  context.beginPath()
  context.lineWidth = 1
  context.strokeStyle = '#7d99d0'
  context.setLineDash([4, 4])
  context.moveTo(pointX, top)
  context.lineTo(pointX, bottom)
  context.stroke()
  context.setLineDash([])
  context.beginPath()
  context.arc(pointX, pointY, 5, 0, Math.PI * 2)
  context.fillStyle = '#2459cd'
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = '#fff'
  context.stroke()
}

function selectPoint(event: PointerEvent) {
  if (!canvas.value || plotWidth <= 0) return
  const offset = event.clientX - canvas.value.getBoundingClientRect().left - plotLeft
  const last = props.dates.length - 1
  selected.value = Math.min(last, Math.max(0, Math.round(offset / plotWidth * last)))
}

watch(() => props.dates, dates => { selected.value = Math.max(0, dates.length - 1) }, { immediate: true })
watch([() => props.dates, () => props.values, selected], draw, { flush: 'post' })
onMounted(() => {
  if (!canvas.value) return
  observer = new ResizeObserver(draw)
  observer.observe(canvas.value)
  draw()
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <figure class="trend-chart">
    <canvas ref="canvas" role="img" :aria-label="`${label}每日趋势，完整数据见逐日明细`"
      @pointermove="selectPoint" @pointerdown="selectPoint" />
    <figcaption class="trend-readout">
      <label v-if="dates.length > 1" class="trend-date-control">
        查看日期
        <input v-model.number="selected" type="range" min="0" :max="dates.length - 1"
          :aria-valuetext="`${dates[selected]}，${label} ${numberFormat.format(values[selected] ?? 0)}`">
      </label>
      <div class="trend-point">
        <time :datetime="dates[selected]">{{ dates[selected] }}</time>
        <span>{{ label }} <strong>{{ numberFormat.format(values[selected] ?? 0) }}</strong></span>
      </div>
    </figcaption>
  </figure>
</template>

<style scoped>
.trend-chart { margin: 18px 0 0; min-width: 0; }
.trend-chart canvas { display: block; width: 100%; height: clamp(210px, 33vw, 310px); }
.trend-readout { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px 20px; border-top: 1px solid var(--line); padding-top: 12px; }
.trend-readout :is(label, time) { color: var(--muted); font-size: .85rem; }
.trend-readout .trend-date-control { display: flex; align-items: center; gap: 10px; }
.trend-date-control input { min-height: 28px; width: min(150px, 32vw); padding: 0; accent-color: var(--action); }
.trend-point { display: flex; align-items: baseline; gap: 10px; margin-inline-start: auto; font-size: .85rem; }
.trend-point strong { color: var(--action); font-size: 1.05rem; font-variant-numeric: tabular-nums; }
</style>
