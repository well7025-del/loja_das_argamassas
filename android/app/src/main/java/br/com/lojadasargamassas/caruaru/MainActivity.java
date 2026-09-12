package br.com.lojadasargamassas.caruaru;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.io.File;
import java.io.IOException;

/**
 * Aplicativo da Loja Caruaru.
 *
 * O sistema inteiro (HTML/CSS/JS) vem embutido no APK e e servido pelo
 * WebViewAssetLoader em https://appassets.androidplatform.net/ — uma origem
 * segura de verdade, o que faz o IndexedDB do aplicativo funcionar e persistir
 * como funcionaria num site. Carregar por file:// nao daria essa garantia.
 *
 * O que o navegador nao oferece dentro de um WebView (voz, camera, salvar e
 * compartilhar arquivo) entra por pontes nativas declaradas aqui.
 */
public class MainActivity extends AppCompatActivity {

    private static final String ORIGEM = "https://appassets.androidplatform.net";
    private static final String PAGINA_INICIAL = ORIGEM + "/assets/loja/index.html";

    private WebView webView;
    private PonteVoz ponteVoz;

    private ValueCallback<Uri[]> retornoArquivos;
    private Uri uriFotoPendente;
    private long ultimoVoltar = 0L;

    private ActivityResultLauncher<Intent> escolherArquivo;
    private ActivityResultLauncher<String> pedirPermissaoCamera;
    private ActivityResultLauncher<String> pedirPermissaoMicrofone;

    @Override
    protected void onCreate(@Nullable Bundle estado) {
        super.onCreate(estado);

        registrarLancadores();

        webView = new WebView(this);
        setContentView(webView);
        configurarWebView();

        ponteVoz = new PonteVoz(this, webView);
        webView.addJavascriptInterface(ponteVoz, "AndroidVoz");
        webView.addJavascriptInterface(new PonteApp(this), "AndroidApp");

        if (estado == null) {
            webView.loadUrl(PAGINA_INICIAL);
        } else {
            webView.restoreState(estado);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                long agora = System.currentTimeMillis();
                if (agora - ultimoVoltar < 2000) {
                    finish();
                } else {
                    ultimoVoltar = agora;
                    Toast.makeText(MainActivity.this, R.string.sair_confirmar, Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void registrarLancadores() {
        escolherArquivo = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                this::tratarArquivoEscolhido);

        pedirPermissaoCamera = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(), concedida -> { /* o proximo toque ja usa */ });

        pedirPermissaoMicrofone = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(), concedida -> {
                    if (concedida) {
                        ponteVoz.iniciarAposPermissao();
                    } else {
                        ponteVoz.avisarErro("Sem permissão de microfone. Libere nas configurações do aplicativo.");
                    }
                });
    }

    private void configurarWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Os arquivos chegam pelo asset loader; acesso direto a file:// fica desligado.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);   // o layout ja e feito para o dedo; ignora a fonte gigante do sistema

        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        final WebViewAssetLoader carregador = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(@NonNull WebView view, @NonNull WebResourceRequest pedido) {
                return carregador.shouldInterceptRequest(pedido.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(@NonNull WebView view, @NonNull WebResourceRequest pedido) {
                Uri destino = pedido.getUrl();
                if (ORIGEM.equals(destino.getScheme() + "://" + destino.getHost())) {
                    return false;                       // navegacao dentro do proprio aplicativo
                }
                abrirExternamente(destino);             // WhatsApp, Google Drive e afins abrem fora
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> retorno, FileChooserParams parametros) {
                if (retornoArquivos != null) {
                    retornoArquivos.onReceiveValue(null);
                }
                retornoArquivos = retorno;
                return abrirSeletor(parametros);
            }
        });
    }

    /* ---------------- Escolha de arquivo e foto ---------------- */

    private boolean abrirSeletor(WebChromeClient.FileChooserParams parametros) {
        String[] aceitos = parametros.getAcceptTypes();
        String tipo = (aceitos != null && aceitos.length > 0 && !aceitos[0].isEmpty()) ? aceitos[0] : "*/*";
        boolean querImagem = tipo.startsWith("image/");

        Intent conteudo = new Intent(Intent.ACTION_GET_CONTENT);
        conteudo.addCategory(Intent.CATEGORY_OPENABLE);
        conteudo.setType(tipo.equals("application/json") ? "*/*" : tipo);

        Intent camera = querImagem ? criarIntentCamera() : null;

        Intent escolha = Intent.createChooser(conteudo,
                getString(querImagem ? R.string.escolher_foto : R.string.compartilhar_backup));
        if (camera != null) {
            escolha.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }

        try {
            escolherArquivo.launch(escolha);
            return true;
        } catch (ActivityNotFoundException e) {
            cancelarEscolha();
            return false;
        }
    }

    private @Nullable Intent criarIntentCamera() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            pedirPermissaoCamera.launch(Manifest.permission.CAMERA);
            return null;                                 // nesta vez vai so a galeria; no proximo toque a camera aparece
        }
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (camera.resolveActivity(getPackageManager()) == null) {
            return null;
        }
        try {
            File pasta = new File(getCacheDir(), "fotos");
            if (!pasta.exists() && !pasta.mkdirs()) return null;
            File destino = File.createTempFile("comprovante_", ".jpg", pasta);
            uriFotoPendente = FileProvider.getUriForFile(this, getPackageName() + ".arquivos", destino);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, uriFotoPendente);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return camera;
        } catch (IOException e) {
            uriFotoPendente = null;
            return null;
        }
    }

    private void tratarArquivoEscolhido(ActivityResult resultado) {
        if (retornoArquivos == null) return;

        Uri[] arquivos = null;
        if (resultado.getResultCode() == Activity.RESULT_OK) {
            Intent dados = resultado.getData();
            if (dados != null && dados.getData() != null) {
                arquivos = new Uri[]{dados.getData()};
            } else if (dados != null && dados.getClipData() != null) {
                ClipData clip = dados.getClipData();
                arquivos = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) {
                    arquivos[i] = clip.getItemAt(i).getUri();
                }
            } else if (uriFotoPendente != null) {
                arquivos = new Uri[]{uriFotoPendente};   // a camera grava direto no arquivo que preparamos
            }
        }

        retornoArquivos.onReceiveValue(arquivos);
        retornoArquivos = null;
        uriFotoPendente = null;
    }

    private void cancelarEscolha() {
        if (retornoArquivos != null) {
            retornoArquivos.onReceiveValue(null);
            retornoArquivos = null;
        }
        uriFotoPendente = null;
    }

    /* ---------------- Apoio as pontes ---------------- */

    void abrirExternamente(Uri destino) {
        try {
            Intent fora = new Intent(Intent.ACTION_VIEW, destino);
            fora.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(fora);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.sem_navegador, Toast.LENGTH_LONG).show();
        }
    }

    void pedirMicrofone() {
        pedirPermissaoMicrofone.launch(Manifest.permission.RECORD_AUDIO);
    }

    boolean temMicrofone() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    /* ---------------- Ciclo de vida ---------------- */

    @Override
    protected void onSaveInstanceState(@NonNull Bundle estado) {
        super.onSaveInstanceState(estado);
        webView.saveState(estado);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        ponteVoz.parar();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        ponteVoz.encerrar();
        cancelarEscolha();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
