package io.github.c1oudreamw.lumatile

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.LocalTime
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * 桌面课表小组件：顶部左侧课表名称、右侧日期周次星期，下方左右两列分别为今天和明天的课程。
 * 两列都是可滚动的 ListView，超过一屏时滑动查看，内容不足时也能下拉回弹（overScrollMode=always）。
 * 数据直接读取应用私有 Room 库，与课表页保持同一数据源；课表保存、切换、删除后由 SchedulePlugin 触发刷新。
 */
class ScheduleWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        Log.e(TAG, "onUpdate ids=${appWidgetIds.contentToString()}")
        val pendingResult = goAsync()
        executor.execute {
            try {
                renderAll(context, manager, appWidgetIds)
                scheduleNextRefresh(context)
            } catch (error: Exception) {
                Log.e(TAG, "renderAll failed", error)
            } finally {
                pendingResult.finish()
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action in REFRESH_ACTIONS) requestUpdate(context)
    }

    companion object {
        private const val TAG = "ScheduleWidget"
        private const val ALARM_REQUEST_CODE = 0x5C4ED
        private val executor = Executors.newSingleThreadExecutor()

        /** 无课占位时轮换显示的颜文字。每次刷新随机选一个，两列共用，保证相邻两天都没课时表情一致。 */
        private val EMOJIS = listOf(
            "ヾ(≧▽≦*)o",
            "(～￣▽￣)～",
            "^o^/",
        )

        /** 直接渲染所有小组件实例，并安排下一次精确刷新。 */
        fun requestUpdate(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            if (manager == null) return
            val ids = manager.getAppWidgetIds(ComponentName(context, ScheduleWidgetProvider::class.java))
            Log.e(TAG, "requestUpdate ids=${ids.contentToString()}")
            if (ids.isEmpty()) return
            executor.execute {
                try {
                    renderAll(context, manager, ids)
                    scheduleNextRefresh(context)
                } catch (error: Exception) {
                    Log.e(TAG, "requestUpdate renderAll failed", error)
                }
            }
        }

        private fun renderAll(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
            val header = try {
                ScheduleWidgetData.loadHeader(context, LocalDate.now())
            } catch (error: Exception) {
                Log.e(TAG, "loadHeader failed", error)
                null
            }
            Log.e(TAG, "renderAll header=${header?.scheduleName ?: "null"}")
            // 每次刷新随机选一个颜文字；两列共用它，天然满足"相邻两天都没课时表情一致"
            val emoji = EMOJIS[Random.nextInt(EMOJIS.size)]
            for (appWidgetId in appWidgetIds) {
                try {
                    manager.updateAppWidget(appWidgetId, viewsFor(context, appWidgetId, header, emoji))
                    Log.e(TAG, "updated id=$appWidgetId")
                } catch (error: Exception) {
                    Log.e(TAG, "updateAppWidget failed id=$appWidgetId", error)
                }
            }
        }

        private fun viewsFor(
            context: Context,
            appWidgetId: Int,
            header: ScheduleWidgetData.WidgetHeader?,
            emoji: String,
        ): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.schedule_widget)
            val launch = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.schedule_widget_root, launch)
            if (header == null) {
                views.setViewVisibility(R.id.schedule_widget_content, View.GONE)
                views.setViewVisibility(R.id.schedule_widget_empty, View.VISIBLE)
                return views
            }
            views.setViewVisibility(R.id.schedule_widget_content, View.VISIBLE)
            views.setViewVisibility(R.id.schedule_widget_empty, View.GONE)
            views.setTextViewText(R.id.schedule_widget_name, header.scheduleName)
            views.setTextViewText(R.id.schedule_widget_info, header.info)
            views.setTextViewText(R.id.schedule_widget_emoji_today, emoji)
            views.setTextViewText(R.id.schedule_widget_emoji_tomorrow, emoji)
            bindColumn(context, views, appWidgetId, R.id.schedule_widget_list_today, R.id.schedule_widget_empty_today, 0)
            bindColumn(context, views, appWidgetId, R.id.schedule_widget_list_tomorrow, R.id.schedule_widget_empty_tomorrow, 1)
            return views
        }

        private fun bindColumn(
            context: Context,
            views: RemoteViews,
            appWidgetId: Int,
            listViewId: Int,
            emptyViewId: Int,
            dayOffset: Int,
        ) {
            val intent = Intent(context, ScheduleWidgetService::class.java).apply {
                putExtra(ScheduleWidgetService.EXTRA_DAY_OFFSET, dayOffset)
                // 相同 component 的 intent 用 data 区分，否则两列会拿到同一个工厂
                data = Uri.parse("lumatile://schedule-widget/$appWidgetId/$dayOffset")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                views.setRemoteAdapter(appWidgetId, listViewId, intent)
            } else {
                @Suppress("DEPRECATION")
                views.setRemoteAdapter(listViewId, intent)
            }
            views.setEmptyView(listViewId, emptyViewId)
            views.setPendingIntentTemplate(
                listViewId,
                PendingIntent.getActivity(
                    context,
                    0,
                    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        }

        /** 在"今天下一节课结束"时安排一次精确刷新，使已上完的课及时隐藏。 */
        private fun scheduleNextRefresh(context: Context) {
            try {
                val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val now = LocalTime.now()
                val triggerAt = ScheduleWidgetData.nextTodayRefreshEpoch(context, now) ?: return
                val intent = Intent(context, ScheduleWidgetProvider::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                }
                val pending = PendingIntent.getBroadcast(
                    context,
                    ALARM_REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                alarm.setAndAllowWhileIdle(AlarmManager.RTC, triggerAt, pending)
                Log.e(TAG, "scheduled next refresh at $triggerAt")
            } catch (error: Exception) {
                Log.e(TAG, "scheduleNextRefresh failed", error)
            }
        }

        private val REFRESH_ACTIONS = setOf(
            Intent.ACTION_DATE_CHANGED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
        )
    }
}
