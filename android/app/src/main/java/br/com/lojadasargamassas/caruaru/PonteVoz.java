package br.com.lojadasargamassas.caruaru;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Reconhecimento de voz nativo.
 *
 * O WebView do Android nao tem a API de voz do navegador, entao o lancamento
 * por voz do PDV falaria sozinho aqui. Esta ponte usa o reconhecedor do proprio
 * Android e devolve o texto para o JavaScript, mantendo o recurso funcionando
 * dentro do aplicativo.
 */
public class PonteVoz implements RecognitionListener {

    private final MainActivity atividade;
    private final WebView webView;
    private final Handler principal = new Handler(Looper.getMainLooper());

    private SpeechRecognizer reconhecedor;
    private boolean queroOuvir = false;
    private boolean continuo = true;

    PonteVoz(MainActivity atividade, WebView webView) {
        this.atividade = atividade;
        this.webView = webView;
    }

    /* ---------------- Chamadas vindas do JavaScript ---------------- */

    @JavascriptInterface
    public boolean disponivel() {
        return SpeechRecognizer.isRecognitionAvailable(atividade);
    }

    /** Um unico metodo, sem sobrecarga: o WebView resolve a chamada por nome. */
    @JavascriptInterface
    public void iniciar(boolean modoContinuo) {
        continuo = modoContinuo;
        if (!atividade.temMicrofone()) {
            principal.post(atividade::pedirMicrofone);
            return;
        }
        queroOuvir = true;
        principal.post(this::escutar);
    }

    @JavascriptInterface
    public void parar() {
        queroOuvir = false;
        principal.post(() -> {
            if (reconhecedor != null) {
                reconhecedor.cancel();
            }
            avisar("estado", "parado");
        });
    }

    /* ---------------- Ciclo do reconhecedor ---------------- */

    private void escutar() {
        if (!queroOuvir) return;
        if (!SpeechRecognizer.isRecognitionAvailable(atividade)) {
            avisarErro("Este aparelho não tem reconhecimento de voz instalado.");
            return;
        }
        if (reconhecedor == null) {
            reconhecedor = SpeechRecognizer.createSpeechRecognizer(atividade);
            reconhecedor.setRecognitionListener(this);
        }
        Intent pedido = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR");
        pedido.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        pedido.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        pedido.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, atividade.getPackageName());
        try {
            reconhecedor.startListening(pedido);
        } catch (Exception e) {
            avisarErro("Não consegui ligar o microfone.");
        }
    }

    void encerrar() {
        queroOuvir = false;
        principal.post(() -> {
            if (reconhecedor != null) {
                reconhecedor.destroy();
                reconhecedor = null;
            }
        });
    }

    /** Chamado pela Activity quando a permissão de microfone é concedida. */
    void iniciarAposPermissao() {
        queroOuvir = true;
        principal.post(this::escutar);
    }

    /* ---------------- Retorno para o JavaScript ---------------- */

    private void avisar(String evento, String valor) {
        String script = "window.__vozAndroid && window.__vozAndroid." + evento + "(" + JSONObject.quote(valor) + ")";
        principal.post(() -> webView.evaluateJavascript(script, null));
    }

    void avisarErro(String mensagem) {
        queroOuvir = false;
        avisar("erro", mensagem);
        avisar("estado", "parado");
    }

    /* ---------------- Eventos do reconhecedor ---------------- */

    @Override public void onReadyForSpeech(Bundle params) { avisar("estado", "ouvindo"); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float rms) { }
    @Override public void onBufferReceived(byte[] buffer) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onEvent(int tipo, Bundle params) { }

    @Override
    public void onPartialResults(Bundle resultados) {
        String texto = primeiro(resultados);
        if (texto != null) avisar("parcial", texto);
    }

    @Override
    public void onResults(Bundle resultados) {
        String texto = primeiro(resultados);
        if (texto != null) avisar("final", texto);
        if (queroOuvir && continuo) {
            principal.postDelayed(this::escutar, 350);   // volta a ouvir para o proximo item do pedido
        } else {
            queroOuvir = false;
            avisar("estado", "parado");
        }
    }

    @Override
    public void onError(int codigo) {
        // Silencio e "nao entendi" sao normais no balcao: seguimos ouvindo.
        boolean recuperavel = codigo == SpeechRecognizer.ERROR_NO_MATCH
                || codigo == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
        if (recuperavel && queroOuvir && continuo) {
            principal.postDelayed(this::escutar, 350);
            return;
        }
        queroOuvir = false;
        avisar("erro", descrever(codigo));
        avisar("estado", "parado");
    }

    private static String descrever(int codigo) {
        switch (codigo) {
            case SpeechRecognizer.ERROR_AUDIO: return "Problema ao gravar o áudio.";
            case SpeechRecognizer.ERROR_CLIENT: return "O reconhecimento de voz foi interrompido.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Sem permissão de microfone.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "O reconhecimento de voz precisa de internet.";
            case SpeechRecognizer.ERROR_NO_MATCH: return "Não entendi o que foi dito.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "O microfone está ocupado. Tente de novo.";
            case SpeechRecognizer.ERROR_SERVER: return "O serviço de voz do Google não respondeu.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "Não ouvi nada.";
            default: return "Erro no reconhecimento de voz (" + codigo + ").";
        }
    }

    private static String primeiro(Bundle resultados) {
        if (resultados == null) return null;
        ArrayList<String> lista = resultados.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (lista == null || lista.isEmpty()) return null;
        String texto = lista.get(0);
        return texto == null ? null : texto.trim().toLowerCase(new Locale("pt", "BR"));
    }
}
