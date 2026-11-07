package com.speakingroom.voice;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;

/** Static packaged notice, without JavaScript, login tokens or native bridge. */
public final class PrivacyActivity extends Activity {
    private WebView web;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web=new WebView(this);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request){return loader.shouldInterceptRequest(request.getUrl());}
        });
        setContentView(web);
        web.loadUrl(MainActivity.ORIGIN+"/assets/privacy.html");
    }
    @Override protected void onDestroy(){if(web!=null)web.destroy();super.onDestroy();}
}
