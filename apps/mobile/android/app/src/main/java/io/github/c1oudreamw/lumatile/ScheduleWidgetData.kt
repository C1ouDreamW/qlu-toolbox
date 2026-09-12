package io.github.c1oudreamw.lumatile

import android.content.Context
import java.time.LocalDate
import java.time.LocalTime
import org.json.JSONArray
import org.json.JSONObject

/**
 * 桌面课表小组件的领域逻辑：周次推算、当天课程筛选和教室名称缩写。
 * 规则与共享包 packages/academic-core 的 TypeScript 实现保持一致；
 * 小组件运行在 RemoteViews 环境中，无法复用 WebView 侧逻辑，因此用 Kotlin 单独实现。
 */
internal object ScheduleWidgetData {
    internal data class WidgetMeeting(
        val weeks: Set<Int>,
        val weekday: Int?,
        val startPeriod: Int?,
        val endPeriod: Int?,
        val location: String,
    )

    internal data class WidgetCourse(
        val name: String,
        val color: String,
        val meetings: List<WidgetMeeting>,
    )

    internal data class ParsedSchedule(
        val startDate: LocalDate,
        val totalWeeks: Int,
        val periodStarts: List<String>,
        val periodEnds: List<String>,
        val noClassDates: Set<String>,
        val courses: List<WidgetCourse>,
    )

    internal data class WidgetItem(
        val courseName: String,
        val location: String,
        val timeText: String,
        val color: Int,
    )

    internal data class WidgetHeader(
        val scheduleName: String,
        val info: String,
    )

    internal data class ActiveSchedule(
        val name: String,
        val schedule: ParsedSchedule,
    )

    /** 与 academic-core 的 weekForDate 相同：开学日期向前对齐到周一，整 7 天进一周。 */
    internal fun weekForDate(startDate: LocalDate, date: LocalDate): Int {
        val monday = startDate.minusDays(((startDate.dayOfWeek.value + 6) % 7).toLong())
        // floorDiv 对开学前的日期向下取整，与 TypeScript 的 Math.floor 一致
        return Math.floorDiv(date.toEpochDay() - monday.toEpochDay(), 7).toInt() + 1
    }

    internal fun classesOn(schedule: ParsedSchedule, date: LocalDate, now: LocalTime? = null): List<WidgetItem> {
        if (schedule.noClassDates.contains(date.toString())) return emptyList()
        val week = weekForDate(schedule.startDate, date)
        val matched = mutableListOf<Match>()
        for (course in schedule.courses) {
            val color = parseColor(course.color, DEFAULT_BAR_COLOR)
            for (meeting in course.meetings) {
                val weekday = meeting.weekday ?: continue
                val startPeriod = meeting.startPeriod ?: continue
                val endPeriod = meeting.endPeriod ?: continue
                if (weekday != date.dayOfWeek.value || week !in meeting.weeks) continue
                val start = schedule.periodStarts.getOrNull(startPeriod - 1) ?: continue
                val end = schedule.periodEnds.getOrNull(endPeriod - 1) ?: continue
                // 过滤已上完的课：传入 now 时，结束时间不晚于 now 的课不再显示
                if (now != null) {
                    val endTime = parseTimeOrNull(end) ?: continue
                    if (!endTime.isAfter(now)) continue
                }
                matched.add(Match(startPeriod, endPeriod, WidgetItem(
                    courseName = course.name,
                    location = abbreviateLocation(meeting.location),
                    timeText = "$start - $end",
                    color = color,
                )))
            }
        }
        return matched.sortedWith(compareBy({ it.startPeriod }, { it.endPeriod })).map { it.item }
    }

    /**
     * 教室名称简化：只去掉开头的"长清校区"前缀，其余（楼号、教室号、JT 标识）原样保留。
     * JT 楼与不带 JT 的公教楼是不同楼栋，故不做任何缩写合并。
     */
    internal fun abbreviateLocation(value: String): String {
        return value.trim().removePrefix("长清校区")
    }

    internal fun headerInfo(date: LocalDate, week: Int, totalWeeks: Int): String {
        val weekText = if (week in 1..totalWeeks) "第${week}周" else "假期中"
        return "${date.monthValue}.${date.dayOfMonth} $weekText ${WEEKDAY_NAMES[date.dayOfWeek.value - 1]}"
    }

    internal fun parseColor(value: String, fallback: Int): Int {
        val hex = value.trim()
        if (!Regex("^#[0-9a-fA-F]{6}$").matches(hex)) return fallback
        return (0xFF shl 24) or hex.substring(1).toInt(16)
    }

    internal fun loadHeader(context: Context, today: LocalDate): WidgetHeader? {
        val active = loadActive(context) ?: return null
        val week = weekForDate(active.schedule.startDate, today)
        return WidgetHeader(active.name, headerInfo(today, week, active.schedule.totalWeeks))
    }

    internal fun loadDay(context: Context, date: LocalDate, now: LocalTime? = null): List<WidgetItem> {
        val active = loadActive(context) ?: return emptyList()
        return classesOn(active.schedule, date, now)
    }

    /**
     * 计算今天剩余课程中最近的结束时间点（epoch 毫秒），用于设置精确刷新闹钟，
     * 使"上完一节课后该课自动隐藏"无需等待 30 分钟兜底周期。
     */
    internal fun nextTodayRefreshEpoch(context: Context, now: LocalTime): Long? {
        val active = loadActive(context) ?: return null
        val schedule = active.schedule
        val today = LocalDate.now()
        val week = weekForDate(schedule.startDate, today)
        var next: LocalTime? = null
        for (course in schedule.courses) {
            for (meeting in course.meetings) {
                val weekday = meeting.weekday ?: continue
                val endPeriod = meeting.endPeriod ?: continue
                if (weekday != today.dayOfWeek.value || week !in meeting.weeks) continue
                val end = schedule.periodEnds.getOrNull(endPeriod - 1) ?: continue
                val endTime = parseTimeOrNull(end) ?: continue
                if (endTime.isAfter(now) && (next == null || endTime.isBefore(next))) next = endTime
            }
        }
        return next?.let {
            today.atTime(it).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        }
    }

    /** 与课表页一致（SchedulePage.vue）：优先 isActive 的课表，否则取最近更新的一张。 */
    private fun loadActive(context: Context): ActiveSchedule? {
        val list = ScheduleDatabase.get(context).schedules().list()
        android.util.Log.d("ScheduleWidget", "loadActive: ${list.size} schedules, active=${list.firstOrNull { it.isActive }?.name ?: "none"}")
        val entity = list.firstOrNull { it.isActive } ?: list.firstOrNull() ?: return null
        val parsed = parseSchedule(entity.payload) ?: return null
        return ActiveSchedule(entity.name, parsed)
    }

    private fun parseSchedule(payload: String): ParsedSchedule? = try {
        val json = JSONObject(payload)
        if (json.optInt("schemaVersion") != 1) null
        else {
            val periods = json.getJSONArray("periods")
            val noClassDates = mutableSetOf<String>()
            val noClassJson = json.getJSONArray("noClassDates")
            for (index in 0 until noClassJson.length()) {
                noClassDates.add(noClassJson.getJSONObject(index).optString("date"))
            }
            val courses = mutableListOf<WidgetCourse>()
            val coursesJson = json.getJSONArray("courses")
            for (courseIndex in 0 until coursesJson.length()) {
                val course = coursesJson.getJSONObject(courseIndex)
                val meetings = mutableListOf<WidgetMeeting>()
                val meetingsJson = course.getJSONArray("meetings")
                for (meetingIndex in 0 until meetingsJson.length()) {
                    val meeting = meetingsJson.getJSONObject(meetingIndex)
                    val weeksJson = meeting.getJSONArray("weeks")
                    meetings.add(WidgetMeeting(
                        weeks = (0 until weeksJson.length()).map { weeksJson.getInt(it) }.toSet(),
                        weekday = meeting.optIntOrNull("weekday"),
                        startPeriod = meeting.optIntOrNull("startPeriod"),
                        endPeriod = meeting.optIntOrNull("endPeriod"),
                        location = meeting.optString("location"),
                    ))
                }
                courses.add(WidgetCourse(
                    name = course.optString("name"),
                    color = course.optString("color"),
                    meetings = meetings,
                ))
            }
            ParsedSchedule(
                startDate = LocalDate.parse(json.getString("startDate")),
                totalWeeks = json.optInt("totalWeeks"),
                periodStarts = (0 until periods.length()).map { periods.getJSONObject(it).optString("start") },
                periodEnds = (0 until periods.length()).map { periods.getJSONObject(it).optString("end") },
                noClassDates = noClassDates,
                courses = courses,
            )
        }
    } catch (_: Exception) { null }

    private fun JSONObject.optIntOrNull(key: String): Int? = if (has(key) && !isNull(key)) getInt(key) else null

    private fun parseTimeOrNull(value: String): LocalTime? = try { LocalTime.parse(value) } catch (_: Exception) { null }

    private data class Match(val startPeriod: Int, val endPeriod: Int, val item: WidgetItem)

    private val WEEKDAY_NAMES = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

    private val DEFAULT_BAR_COLOR: Int = 0xFF4F86C6.toInt()
}
