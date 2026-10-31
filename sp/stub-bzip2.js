// bzip2 routed to the host (__host.bzip2*)
const BZip2 = {
    decompress(compressed, decompressedLength, prependHeader = false, containsDecompressedLength = false) {
        return globalThis.__host.bzip2Decompress(compressed, decompressedLength, prependHeader, containsDecompressedLength);
    },
    compress(decompressed) {
        return globalThis.__host.bzip2Compress(decompressed);
    }
};
export default BZip2;
