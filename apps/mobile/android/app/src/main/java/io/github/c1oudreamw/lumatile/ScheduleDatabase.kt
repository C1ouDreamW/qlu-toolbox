package io.github.c1oudreamw.lumatile

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction

@Entity(tableName = "schedules", primaryKeys = ["scheduleId"])
internal data class ScheduleEntity(
    val scheduleId: String,
    val name: String,
    val payload: String,
    val updatedAt: String,
    val isActive: Boolean,
)

@Dao
internal interface ScheduleDao {
    @Query("SELECT * FROM schedules ORDER BY isActive DESC, updatedAt DESC")
    fun list(): List<ScheduleEntity>

    @Query("SELECT * FROM schedules WHERE scheduleId = :scheduleId LIMIT 1")
    fun get(scheduleId: String): ScheduleEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun put(entity: ScheduleEntity)

    @Query("UPDATE schedules SET isActive = 0")
    fun clearActive()

    @Query("UPDATE schedules SET isActive = CASE WHEN scheduleId = :scheduleId THEN 1 ELSE 0 END")
    fun activate(scheduleId: String)

    @Query("DELETE FROM schedules WHERE scheduleId = :scheduleId")
    fun delete(scheduleId: String)

    @Transaction
    fun save(entity: ScheduleEntity, makeActive: Boolean) {
        if (makeActive) clearActive()
        put(entity.copy(isActive = makeActive || entity.isActive))
    }
}

@Database(entities = [ScheduleEntity::class], version = 1, exportSchema = true)
internal abstract class ScheduleDatabase : RoomDatabase() {
    abstract fun schedules(): ScheduleDao

    companion object {
        @Volatile private var instance: ScheduleDatabase? = null

        fun get(context: Context): ScheduleDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                ScheduleDatabase::class.java,
                "schedules.db",
            ).build().also { instance = it }
        }
    }
}
