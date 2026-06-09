package com.arviewer.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 申请系统摄像头权限
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this, new String[]{Manifest.permission.CAMERA}, 100);
        }

        // 放行 WebView 内网页发起的摄像头请求
        getBridge().getWebView().setWebChromeClient(
                new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(new Runnable() {
                            @Override public void run() { request.grant(request.getResources()); }
                        });
                    }
                });

        // 暴露给网页：用原生 Intent 调起 Google Scene Viewer（ar_only 真地面放置）
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void sceneViewer(final String fileUrl, final String title) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { launchSceneViewer(fileUrl, title); }
                });
            }

            @JavascriptInterface
            public void nativeAR(final String url, final String title) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        Intent i = new Intent(MainActivity.this, ARActivity.class);
                        i.putExtra("url", url);
                        i.putExtra("name", title);
                        startActivity(i);
                    }
                });
            }
        }, "AndroidAR");
    }

    private void launchSceneViewer(String fileUrl, String title) {
        Uri uri = Uri.parse("https://arvr.google.com/scene-viewer/1.0").buildUpon()
                .appendQueryParameter("file", fileUrl)
                .appendQueryParameter("mode", "ar_only")
                .appendQueryParameter("title", title == null ? "" : title)
                .build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // 优先指定 Scene Viewer 的宿主包，失败再交给系统选择
        intent.setPackage("com.google.android.googlequicksearchbox");
        try {
            startActivity(intent);
        } catch (Exception e) {
            intent.setPackage(null);
            try { startActivity(intent); } catch (Exception ignored) {}
        }
    }
}
