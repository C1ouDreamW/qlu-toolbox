package io.github.c1oudreamw.lumatile

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class ScheduleWidgetDataTest {
    private val periodStarts = listOf(
        "08:30", "09:20", "10:25", "11:15", "13:30", "14:20", "15:20", "16:05", "17:50", "18:35", "19:30",
    )
    private val periodEnds = listOf(
        "09:15", "10:05", "11:10", "12:00", "14:15", "15:05", "16:05", "16:50", "18:35", "19:20", "20:15",
    )

    private fun schedule(
        courses: List<ScheduleWidgetData.WidgetCourse>,
        startDate: String = "2026-09-07",
        totalWeeks: Int = 19,
        noClassDates: Set<String> = emptySet(),
    ) = ScheduleWidgetData.ParsedSchedule(
        startDate = LocalDate.parse(startDate),
        totalWeeks = totalWeeks,
        periodStarts = periodStarts,
        periodEnds = periodEnds,
        noClassDates = noClassDates,
        courses = courses,
    )

    private fun course(
        name: String = "计算方法",
        color: String = "#4F86C6",
        meetings: List<ScheduleWidgetData.WidgetMeeting> = emptyList(),
    ) = ScheduleWidgetData.WidgetCourse(name, color, meetings)

    private fun meeting(
        weeks: Set<Int> = setOf(1),
        weekday: Int? = 4,
        startPeriod: Int? = 7,
        endPeriod: Int? = 8,
        location: String = "长清校区2号公教楼307",
    ) = ScheduleWidgetData.WidgetMeeting(weeks, weekday, startPeriod, endPeriod, location)

    @Test
    fun computesWeeksFromMondayAlignedStartDate() {
        val start = LocalDate.parse("2026-09-07")
        assertEquals(1, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-07")))
        assertEquals(1, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-13")))
        assertEquals(2, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-14")))
        assertEquals(0, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-06")))
    }

    @Test
    fun alignsMidWeekSemesterStartToMonday() {
        // 2026-09-12 是周六，所属周的周一为 09-07，即第 1 周从 09-07 算起
        val start = LocalDate.parse("2026-09-12")
        assertEquals(1, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-07")))
        assertEquals(1, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-12")))
        assertEquals(2, ScheduleWidgetData.weekForDate(start, LocalDate.parse("2026-09-14")))
    }

    @Test
    fun listsTodayClassesWithAbbreviatedLocationAndPeriodTime() {
        val parsed = schedule(courses = listOf(course(meetings = listOf(meeting()))))
        val items = ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10"))
        assertEquals(1, items.size)
        assertEquals("计算方法", items[0].courseName)
        assertEquals("2号公教楼307", items[0].location)
        assertEquals("15:20 - 16:50", items[0].timeText)
    }

    @Test
    fun sortsClassesByStartPeriod() {
        val parsed = schedule(courses = listOf(
            course(name = "第二节课", meetings = listOf(meeting(startPeriod = 3, endPeriod = 4, location = "长清校区1号公教楼JT201"))),
            course(name = "第一节课", meetings = listOf(meeting(startPeriod = 1, endPeriod = 2, location = "长清校区1号公教楼JT105"))),
        ))
        val items = ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10"))
        assertEquals(listOf("第一节课", "第二节课"), items.map { it.courseName })
        assertEquals("1号公教楼JT105", items[0].location)
        assertEquals("1号公教楼JT201", items[1].location)
    }

    @Test
    fun keepsFullLocationForUnknownBuildings() {
        assertEquals("文科楼A301", ScheduleWidgetData.abbreviateLocation("长清校区文科楼A301"))
        assertEquals("图书馆", ScheduleWidgetData.abbreviateLocation("图书馆"))
        assertEquals("2号公教楼", ScheduleWidgetData.abbreviateLocation("长清校区2号公教楼"))
    }

    @Test
    fun abbreviatesTeachingBuildingRooms() {
        // 只去掉"长清校区"前缀，其余原样保留；JT 与非 JT 楼不合并
        assertEquals("2号公教楼307", ScheduleWidgetData.abbreviateLocation("长清校区2号公教楼307"))
        assertEquals("2号公教楼JT307", ScheduleWidgetData.abbreviateLocation("长清校区2号公教楼JT307"))
        assertEquals("12号公教楼1101", ScheduleWidgetData.abbreviateLocation("长清校区12号公教楼1101"))
        assertEquals("2号公教楼307", ScheduleWidgetData.abbreviateLocation("2号公教楼307"))
        assertEquals("1号公教楼JT304", ScheduleWidgetData.abbreviateLocation("1号公教楼JT304"))
        assertEquals("文科楼228", ScheduleWidgetData.abbreviateLocation("文科楼228"))
    }

    @Test
    fun skipsNoClassDatesAndUntimedMeetings() {
        val parsed = schedule(
            courses = listOf(course(meetings = listOf(
                meeting(),
                meeting(weekday = null, startPeriod = null, endPeriod = null, location = "待安排"),
            ))),
            noClassDates = setOf("2026-09-10"),
        )
        assertEquals(0, ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10")).size)
        assertEquals(0, ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-17")).size)
    }

    @Test
    fun tomorrowCrossesWeekBoundary() {
        val parsed = schedule(courses = listOf(
            course(name = "跨周课程", meetings = listOf(meeting(weeks = setOf(2), weekday = 1, startPeriod = 1, endPeriod = 2, location = "长清校区3号公教楼502"))),
        ))
        // 09-13 是周日，明天为第 2 周周一
        val items = ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-14"))
        assertEquals(1, items.size)
        assertEquals("3号公教楼502", items[0].location)
    }

    @Test
    fun filtersClassesThatAlreadyEnded() {
        val parsed = schedule(courses = listOf(
            course(name = "早课", meetings = listOf(meeting(startPeriod = 1, endPeriod = 2, location = "2号公教楼101"))),
            course(name = "晚课", meetings = listOf(meeting(startPeriod = 7, endPeriod = 8, location = "2号公教楼307"))),
        ))
        // 现在是 10:30，早课(第1-2节 08:30-10:05)已上完，晚课(第7-8节)还在后面
        val items = ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10"), LocalTime.parse("10:30"))
        assertEquals(listOf("晚课"), items.map { it.courseName })
    }

    @Test
    fun filtersAllWhenDayFinished() {
        val parsed = schedule(courses = listOf(
            course(name = "唯一课", meetings = listOf(meeting(startPeriod = 1, endPeriod = 2, location = "2号公教楼101"))),
        ))
        // 21:00 已超过最后一节课
        val items = ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10"), LocalTime.parse("21:00"))
        assertEquals(0, items.size)
    }

    @Test
    fun computesNextTodayRefreshEpoch() {
        // nextTodayRefreshEpoch 依赖 Room，无法在纯 JVM 单测中运行，仅验证其依赖的 classesOn 行为一致
        val parsed = schedule(courses = listOf(
            course(name = "课", meetings = listOf(meeting(startPeriod = 1, endPeriod = 2, location = "2号公教楼101"))),
        ))
        // 上课前(08:00)能看到课，下课后(10:30，第1-2节 10:05 已结束)看不到
        assertEquals(1, ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10"), LocalTime.parse("08:00")).size)
        assertEquals(0, ScheduleWidgetData.classesOn(parsed, LocalDate.parse("2026-09-10"), LocalTime.parse("10:30")).size)
    }

    @Test
    fun headerShowsDateWeekAndWeekday() {
        assertEquals("9.10 第1周 周四", ScheduleWidgetData.headerInfo(LocalDate.parse("2026-09-10"), 1, 19))
        assertEquals("1.1 假期中 周五", ScheduleWidgetData.headerInfo(LocalDate.parse("2027-01-01"), 0, 19))
        assertEquals("9.10 第19周 周四", ScheduleWidgetData.headerInfo(LocalDate.parse("2026-09-10"), 19, 19))
        assertEquals("9.10 假期中 周四", ScheduleWidgetData.headerInfo(LocalDate.parse("2026-09-10"), 20, 19))
    }

    @Test
    fun parsesCourseColorWithFallback() {
        assertEquals(0xFF4F86C6.toInt(), ScheduleWidgetData.parseColor("#4F86C6", 1))
        assertEquals(1, ScheduleWidgetData.parseColor("red", 1))
        assertEquals(1, ScheduleWidgetData.parseColor("", 1))
    }
}
