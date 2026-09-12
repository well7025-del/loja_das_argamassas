# As pontes JavaScript sao chamadas por nome pelo WebView: nao podem ser renomeadas.
-keepclassmembers class br.com.lojadasargamassas.caruaru.** {
    @android.webkit.JavascriptInterface <methods>;
}
