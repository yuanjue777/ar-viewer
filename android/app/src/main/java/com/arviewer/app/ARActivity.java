package com.arviewer.app;

import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.ar.core.Anchor;
import com.google.ar.sceneform.AnchorNode;
import com.google.ar.sceneform.rendering.ModelRenderable;
import com.google.ar.sceneform.ux.ArFragment;
import com.google.ar.sceneform.ux.TransformableNode;

/**
 * 原生 ARCore 相机放置页：开相机 -> 检测平面 -> 点击放置 glTF 模型 ->
 * 可手势移动/旋转/缩放，并随 ARCore 追踪在现实中 360° 环绕观看。
 * 模型从传入的 URL 下载（本地追踪，不需要 Google 联网/VPN）。
 */
public class ARActivity extends AppCompatActivity {
    private ArFragment arFragment;
    private ModelRenderable renderable;
    private TextView hint;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_ar);

        hint = findViewById(R.id.hint);
        findViewById(R.id.btnClose).setOnClickListener(v -> finish());
        arFragment = (ArFragment) getSupportFragmentManager().findFragmentById(R.id.arFragment);

        loadModel(getIntent().getStringExtra("url"));

        if (arFragment != null) {
            arFragment.setOnTapArPlaneListener((hitResult, plane, motionEvent) -> {
                if (renderable == null) {
                    Toast.makeText(this, "模型还在加载中…", Toast.LENGTH_SHORT).show();
                    return;
                }
                Anchor anchor = hitResult.createAnchor();
                AnchorNode anchorNode = new AnchorNode(anchor);
                anchorNode.setParent(arFragment.getArSceneView().getScene());

                TransformableNode node = new TransformableNode(arFragment.getTransformationSystem());
                node.getScaleController().setMinScale(0.05f);
                node.getScaleController().setMaxScale(20f);
                node.setRenderable(renderable);
                node.setParent(anchorNode);
                node.select();

                if (hint != null) hint.setVisibility(View.GONE);
            });
        }
    }

    private void loadModel(String url) {
        if (url == null || url.isEmpty()) {
            Toast.makeText(this, "缺少模型地址", Toast.LENGTH_LONG).show();
            return;
        }
        ModelRenderable.builder()
                .setSource(this, Uri.parse(url))
                .setIsFilamentGltf(true)
                .setAsyncLoadEnabled(true)
                .setRegistryId(url)
                .build()
                .thenAccept(r -> renderable = r)
                .exceptionally(t -> {
                    Toast.makeText(this, "模型加载失败：" + t.getMessage(), Toast.LENGTH_LONG).show();
                    return null;
                });
    }
}
