/* Freestanding support for compiler-generated copies. Aligned words avoid a
 * byte loop for the controller's state snapshots; unaligned edges stay bytes. */
#include <stddef.h>
#include <stdint.h>

typedef uint32_t __attribute__((__may_alias__)) copy_word_t;

__attribute__((used, externally_visible))
void *memcpy(void *destination, const void *source, size_t count)
{
    unsigned char *to = destination;
    const unsigned char *from = source;
    if ((((uintptr_t)to | (uintptr_t)from) & 3u) == 0u) {
        while (count >= sizeof(copy_word_t)) {
            *(copy_word_t *)to = *(const copy_word_t *)from;
            to += sizeof(copy_word_t);
            from += sizeof(copy_word_t);
            count -= sizeof(copy_word_t);
        }
    }
    while (count--) *to++ = *from++;
    return destination;
}

__attribute__((used, externally_visible))
void *memset(void *destination, int value, size_t count)
{
    unsigned char *to = destination;
    unsigned char byte = (unsigned char)value;
    while (count && ((uintptr_t)to & 3u)) { *to++ = byte; --count; }
    uint32_t word = (uint32_t)byte * 0x01010101u;
    while (count >= sizeof(copy_word_t)) {
        *(copy_word_t *)to = word;
        to += sizeof(copy_word_t);
        count -= sizeof(copy_word_t);
    }
    while (count--) *to++ = byte;
    return destination;
}
