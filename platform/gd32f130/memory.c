/* Minimal freestanding runtime support for compiler-generated copies. */
#include <stddef.h>

__attribute__((used, externally_visible))
void *memcpy(void *destination, const void *source, size_t count)
{
    unsigned char *to = destination;
    const unsigned char *from = source;
    for (size_t i = 0; i < count; ++i) to[i] = from[i];
    return destination;
}

__attribute__((used, externally_visible))
void *memset(void *destination, int value, size_t count)
{
    unsigned char *to = destination;
    for (size_t i = 0; i < count; ++i) to[i] = (unsigned char)value;
    return destination;
}
