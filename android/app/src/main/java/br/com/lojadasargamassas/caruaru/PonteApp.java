package br.com.lojadasargamassas.caruaru;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Ponte com o Android para o que o WebView nao resolve sozinho:
 * abrir links fora do aplicativo e gravar/compartilhar o arquivo de backup.
 *
 * O backup e sempre gravado em Downloads/LojaCaruaru — assim existe uma copia
 * no aparelho mesmo que ninguem toque em mais nada — e, quando pedido, abre o
 * menu de compartilhamento, onde o Google Drive aparece na lista.
 */
public class PonteApp {

    private static final String PASTA = "LojaCaruaru";

    private final MainActivity atividade;

    PonteApp(MainActivity atividade) {
        this.atividade = atividade;
    }

    @JavascriptInterface
    public boolean dentroDoApp() {
        return true;
    }

    @JavascriptInterface
    public String versao() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public void abrirLink(String url) {
        if (url == null || url.isEmpty()) return;
        atividade.runOnUiThread(() -> atividade.abrirExternamente(Uri.parse(url)));
    }

    /**
     * Grava o backup e, se pedido, abre o menu de compartilhamento.
     * Devolve ao JavaScript uma descricao curta do que aconteceu.
     */
    @JavascriptInterface
    public String salvarBackup(String nome, String conteudo, boolean compartilhar) {
        return gravar(nome == null || nome.isEmpty() ? "backup-loja-caruaru.json" : nome,
                conteudo == null ? null : conteudo.getBytes(StandardCharsets.UTF_8),
                "application/json", compartilhar);
    }

    /**
     * Grava um arquivo binario (PDF do comprovante, relatorio) vindo em base64
     * e abre o compartilhamento — e assim o cupom sai pelo WhatsApp do cliente.
     */
    @JavascriptInterface
    public String salvarArquivo(String nome, String base64, String tipo, boolean compartilhar) {
        if (nome == null || nome.isEmpty()) return "erro:sem nome de arquivo";
        if (base64 == null) return "erro:sem conteúdo";
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return "erro:arquivo inválido";
        }
        return gravar(nome, bytes, tipo == null || tipo.isEmpty() ? "application/octet-stream" : tipo, compartilhar);
    }

    private String gravar(String nome, byte[] bytes, String tipo, boolean compartilhar) {
        if (bytes == null) return "erro:sem conteúdo";
        String ondeSalvou;
        try {
            ondeSalvou = gravarEmDownloads(nome, bytes, tipo);
        } catch (Exception e) {
            ondeSalvou = null;
        }

        if (compartilhar) {
            try {
                File copia = gravarNoCache(nome, bytes);
                Uri uri = FileProvider.getUriForFile(atividade, atividade.getPackageName() + ".arquivos", copia);
                final String tipoFinal = tipo;
                atividade.runOnUiThread(() -> compartilharArquivo(uri, tipoFinal));
            } catch (IOException e) {
                return ondeSalvou != null ? "salvo:" + ondeSalvou : "erro:não consegui gravar o arquivo";
            }
        }

        if (ondeSalvou != null) return "salvo:" + ondeSalvou;
        return compartilhar ? "compartilhado" : "erro:não consegui gravar o arquivo";
    }

    private void compartilharArquivo(Uri uri, String tipo) {
        Intent envio = new Intent(Intent.ACTION_SEND);
        envio.setType(tipo);
        envio.putExtra(Intent.EXTRA_STREAM, uri);
        envio.putExtra(Intent.EXTRA_SUBJECT, "Loja Caruaru");
        envio.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent escolha = Intent.createChooser(envio, atividade.getString(R.string.compartilhar_backup));
        escolha.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        atividade.startActivity(escolha);
    }

    private File gravarNoCache(String nome, byte[] bytes) throws IOException {
        File pasta = new File(atividade.getCacheDir(), "backups");
        if (!pasta.exists() && !pasta.mkdirs()) throw new IOException("pasta temporária indisponível");
        File destino = new File(pasta, nome);
        try (FileOutputStream saida = new FileOutputStream(destino)) {
            saida.write(bytes);
        }
        return destino;
    }

    /** Downloads/LojaCaruaru — a copia que sobrevive a desinstalar o aplicativo. */
    private String gravarEmDownloads(String nome, byte[] bytes, String tipo) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = atividade.getContentResolver();
            ContentValues dados = new ContentValues();
            dados.put(MediaStore.Downloads.DISPLAY_NAME, nome);
            dados.put(MediaStore.Downloads.MIME_TYPE, tipo);
            dados.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + PASTA);
            dados.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri destino = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, dados);
            if (destino == null) throw new IOException("Downloads indisponível");
            try (OutputStream saida = resolver.openOutputStream(destino)) {
                if (saida == null) throw new IOException("Downloads indisponível");
                saida.write(bytes);
            }
            dados.clear();
            dados.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(destino, dados, null, null);
            return "Downloads/" + PASTA + "/" + nome;
        }

        // Android 9 e anteriores: pasta publica de Downloads (permissao declarada no manifesto)
        File pasta = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), PASTA);
        if (!pasta.exists() && !pasta.mkdirs()) {
            // sem acesso a pasta publica, guarda na area do proprio aplicativo
            pasta = atividade.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
            if (pasta == null) throw new IOException("armazenamento indisponível");
        }
        File destino = new File(pasta, nome);
        try (FileOutputStream saida = new FileOutputStream(destino)) {
            saida.write(bytes);
        }
        return destino.getAbsolutePath();
    }
}
