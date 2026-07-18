package cn.edu.qlu.toolbox

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        registerPlugin(GradeExportPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
