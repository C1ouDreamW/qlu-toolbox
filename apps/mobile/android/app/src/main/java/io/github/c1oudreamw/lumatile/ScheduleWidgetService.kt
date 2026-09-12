package io.github.c1oudreamw.lumatile

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.time.LocalDate
import java.time.LocalTime

/** 为小组件的"今天/明天"两列提供可滚动的课程列表数据。 */
class ScheduleWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = ScheduleColumnFactory(intent)

    private inner class ScheduleColumnFactory(private val intent: Intent) : RemoteViewsFactory {
        private var items: List<ScheduleWidgetData.WidgetItem> = emptyList()

        override fun onCreate() {}

        override fun onDataSetChanged() {
            val dayOffset = intent.getIntExtra(EXTRA_DAY_OFFSET, 0)
            val today = LocalDate.now()
            val date = today.plusDays(dayOffset.toLong())
            // 今天列按当前时间过滤已上完的课；明天列不过滤
            val now = if (dayOffset == 0) LocalTime.now() else null
            items = ScheduleWidgetData.loadDay(this@ScheduleWidgetService, date, now)
        }

        override fun onDestroy() {}

        override fun getCount(): Int = items.size

        override fun getViewAt(position: Int): RemoteViews {
            val item = items[position]
            val views = RemoteViews(packageName, R.layout.schedule_widget_item)
            views.setTextViewText(R.id.schedule_widget_item_name, item.courseName)
            views.setTextViewText(R.id.schedule_widget_item_location, item.location)
            views.setTextViewText(R.id.schedule_widget_item_time, item.timeText)
            views.setInt(R.id.schedule_widget_item_bar, "setBackgroundColor", item.color)
            // 点击课程打开应用
            views.setOnClickFillInIntent(R.id.schedule_widget_item_root, Intent())
            return views
        }

        override fun getLoadingView(): RemoteViews? = null

        override fun getViewTypeCount(): Int = 1

        override fun getItemId(position: Int): Long = position.toLong()

        override fun hasStableIds(): Boolean = false
    }

    companion object {
        const val EXTRA_DAY_OFFSET = "scheduleWidgetDayOffset"
    }
}
