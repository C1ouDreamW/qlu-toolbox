package cn.edu.qlu.toolbox

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Entity(tableName = "grade_tasks", primaryKeys = ["taskId"])
internal data class GradeTaskEntity(
    val taskId: String,
    val academicYear: String,
    val semester: String,
    val stage: String,
    val outcome: String,
    val artifactState: String,
    val message: String,
    val errorCode: String,
    val artifactId: String?,
    val displayName: String?,
    val mimeType: String?,
    val size: Long,
    val sha256: String?,
    val expiresAt: String?,
    val savedUri: String?,
    val createdAt: String,
    val updatedAt: String,
    val seq: Long,
)

@Dao
internal interface GradeTaskDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun put(task: GradeTaskEntity)

    @Query("SELECT * FROM grade_tasks WHERE taskId = :taskId LIMIT 1")
    fun get(taskId: String): GradeTaskEntity?

    @Query("SELECT * FROM grade_tasks WHERE artifactId = :artifactId LIMIT 1")
    fun getByArtifact(artifactId: String): GradeTaskEntity?

    @Query("SELECT * FROM grade_tasks WHERE outcome = 'running' ORDER BY createdAt DESC LIMIT 1")
    fun getActive(): GradeTaskEntity?

    @Query("SELECT * FROM grade_tasks ORDER BY createdAt DESC LIMIT :limit")
    fun list(limit: Int): List<GradeTaskEntity>

    @Query("SELECT * FROM grade_tasks WHERE artifactState = 'temporary' AND expiresAt IS NOT NULL AND expiresAt < :now")
    fun expiredArtifacts(now: String): List<GradeTaskEntity>
}

@Database(entities = [GradeTaskEntity::class], version = 1, exportSchema = true)
internal abstract class GradeTaskDatabase : RoomDatabase() {
    abstract fun tasks(): GradeTaskDao

    companion object {
        @Volatile private var instance: GradeTaskDatabase? = null

        fun get(context: Context): GradeTaskDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                GradeTaskDatabase::class.java,
                "grade-tasks.db",
            ).build().also { instance = it }
        }
    }
}
