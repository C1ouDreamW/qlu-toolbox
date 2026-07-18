package cn.edu.qlu.toolbox.mobilepoc;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GradeExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
